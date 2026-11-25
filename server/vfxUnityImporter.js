// Editor-only importer included with each VFX bundle. No Unity package dependencies beyond URP.
export const unityVfxImporter = String.raw`#if UNITY_EDITOR
using System;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Foundry.Editor {
public static class FoundryVfxImporter {
    [Serializable] public class Range { public float min, max; }
    [Serializable] public class Burst { public int count; public float time; }
    [Serializable] public class Emission { public float rateOverTime, rateOverDistance; }
    [Serializable] public class Velocity { public float speedMin, speedMax; }
    [Serializable] public class ColorKey { public string color; public float time; }
    [Serializable] public class ParticleConfig {
        public Range lifetime, size;
        public Emission emission;
        public Velocity velocity;
        public Burst[] bursts;
        public ColorKey[] colorOverLife;
    }
    [Serializable] public class TextureEntry { public string kind, fileName; }
    [Serializable] public class Binding { public string fileName, slot; }
    [Serializable] public class MaterialConfig { public string shader; public Binding[] textureBindings; }
    [Serializable] public class Recipe {
        public string displayName, exportTarget;
        public bool looping;
        public int frameCount;
        public TextureEntry[] textures;
        public ParticleConfig particleSystemConfig;
        public MaterialConfig materialConfig;
    }

    [MenuItem("Tools/Foundry/Import VFX Recipe")]
    public static void Import() {
        var path = EditorUtility.OpenFilePanel("Select exported recipe.json", Application.dataPath, "json");
        if (string.IsNullOrEmpty(path)) return;
        GameObject go = null;
        try {
            var assetRoot = Path.GetFullPath(Application.dataPath).Replace('\\', '/') + "/";
            var full = Path.GetFullPath(path).Replace('\\', '/');
            if (!full.StartsWith(assetRoot, StringComparison.OrdinalIgnoreCase)) throw new Exception("Extract the bundle inside this project's Assets folder first.");
            var folder = Path.GetDirectoryName(full).Replace('\\', '/');
            var recipe = JsonUtility.FromJson<Recipe>(File.ReadAllText(full));
            if (recipe == null || recipe.particleSystemConfig == null || recipe.materialConfig == null || recipe.textures == null || recipe.frameCount < 4 || recipe.frameCount > 30) throw new Exception("Invalid VFX recipe.");
            if (recipe.exportTarget != "particle-system") throw new Exception("This is VFX Graph guidance, not a native graph. Configure the graph manually using recipe.json and the exported textures.");
            var shader = Shader.Find("Universal Render Pipeline/Particles/Unlit");
            if (shader == null) throw new Exception("Install and configure Universal Render Pipeline before importing.");
            Func<string, string> assetPath = relative => {
                var target = Path.GetFullPath(Path.Combine(folder, relative)).Replace('\\', '/');
                if (!target.StartsWith(folder + "/", StringComparison.OrdinalIgnoreCase)) throw new Exception("Texture path escapes the bundle folder.");
                return "Assets/" + target.Substring(assetRoot.Length);
            };
            bool flipbook = false;
            foreach (var texture in recipe.textures) {
                var file = assetPath(texture.fileName);
                AssetDatabase.ImportAsset(file);
                var importer = AssetImporter.GetAtPath(file) as TextureImporter;
                if (importer == null) throw new Exception("Missing texture: " + file);
                importer.textureType = TextureImporterType.Default;
                importer.npotScale = TextureImporterNPOTScale.None;
                importer.maxTextureSize = 16384;
                importer.mipmapEnabled = false;
                importer.textureCompression = TextureImporterCompression.Uncompressed;
                importer.sRGBTexture = texture.kind != "noise" && texture.kind != "dissolve-mask";
                importer.wrapMode = texture.kind == "flipbook" ? TextureWrapMode.Clamp : TextureWrapMode.Repeat;
                importer.SaveAndReimport();
                if (texture.kind == "flipbook") flipbook = true;
            }
            var mat = new Material(shader);
            mat.SetFloat("_Surface", 1);
            mat.SetFloat("_Blend", 2);
            mat.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            mat.SetFloat("_DstBlend", (float)BlendMode.One);
            mat.SetFloat("_ZWrite", 0);
            mat.SetFloat("_Cull", (float)CullMode.Off);
            mat.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            mat.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            mat.SetOverrideTag("RenderType", "Transparent");
            mat.renderQueue = (int)RenderQueue.Transparent;
            foreach (var binding in recipe.materialConfig.textureBindings) {
                if (mat.HasProperty(binding.slot)) mat.SetTexture(binding.slot, AssetDatabase.LoadAssetAtPath<Texture2D>(assetPath(binding.fileName)));
            }
            var output = "Assets" + folder.Substring(assetRoot.Length - 1) + "/";
            var materialPath = AssetDatabase.GenerateUniqueAssetPath(output + "FoundryEffect.mat");
            AssetDatabase.CreateAsset(mat, materialPath);
            go = new GameObject(string.IsNullOrEmpty(recipe.displayName) ? "Foundry Effect" : recipe.displayName);
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var config = recipe.particleSystemConfig;
            var main = ps.main;
            main.loop = recipe.looping;
            main.duration = Mathf.Max(1, config.lifetime.max);
            main.startLifetime = new ParticleSystem.MinMaxCurve(config.lifetime.min, config.lifetime.max);
            main.startSize = new ParticleSystem.MinMaxCurve(config.size.min, config.size.max);
            main.startSpeed = new ParticleSystem.MinMaxCurve(config.velocity.speedMin, config.velocity.speedMax);
            main.simulationSpace = ParticleSystemSimulationSpace.Local;
            main.maxParticles = 1000;
            var emission = ps.emission;
            emission.rateOverTime = config.emission.rateOverTime;
            emission.rateOverDistance = config.emission.rateOverDistance;
            var bursts = new ParticleSystem.Burst[config.bursts.Length];
            for (int i = 0; i < bursts.Length; i++) bursts[i] = new ParticleSystem.Burst(config.bursts[i].time, (short)config.bursts[i].count);
            emission.SetBursts(bursts);
            var shape = ps.shape;
            shape.enabled = false;
            var color = ps.colorOverLifetime;
            color.enabled = true;
            var keys = new GradientColorKey[config.colorOverLife.Length];
            var alphas = new GradientAlphaKey[keys.Length];
            for (int i = 0; i < keys.Length; i++) {
                Color parsed;
                if (!ColorUtility.TryParseHtmlString(config.colorOverLife[i].color, out parsed)) parsed = Color.white;
                keys[i] = new GradientColorKey(parsed, config.colorOverLife[i].time);
                alphas[i] = new GradientAlphaKey(parsed.a, config.colorOverLife[i].time);
            }
            var gradient = new Gradient();
            gradient.SetKeys(keys, alphas);
            color.color = gradient;
            var sheet = ps.textureSheetAnimation;
            sheet.enabled = flipbook;
            if (flipbook) {
                sheet.numTilesX = recipe.frameCount;
                sheet.numTilesY = 1;
                sheet.animation = ParticleSystemAnimationType.WholeSheet;
                sheet.frameOverTime = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0, 0, 1, 0.999999f));
                sheet.cycleCount = 1;
            }
            var renderer = ps.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Billboard;
            renderer.sharedMaterial = mat;
            var prefabPath = AssetDatabase.GenerateUniqueAssetPath(output + "FoundryEffect.prefab");
            PrefabUtility.SaveAsPrefabAsset(go, prefabPath);
            AssetDatabase.SaveAssets();
            EditorGUIUtility.PingObject(AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath));
        } catch (Exception error) {
            Debug.LogException(error);
            EditorUtility.DisplayDialog("Foundry VFX import", error.Message, "OK");
        } finally {
            if (go != null) UnityEngine.Object.DestroyImmediate(go);
        }
    }
}
}
#endif
`
