# The Foundry — Codex Edition

The Foundry is a local browser app for asset generation and PBR material finishing. The `main` branch is the Codex-only edition. All AI generation and prompt assistance run through your signed-in local Codex runtime. Workflows include Armory, Character Sheet, Variant Forge, Portrait Studio, Texture Lab, Action Animator, and VFX Forge.

## Run locally

Requires Node.js 20.19+ (or a supported newer LTS) and npm.

On Windows, run `npm ci` and `npm run build:exe`, then double-click **The Foundry Web.exe** in the repository root. The launcher starts the local server and opens your default browser. Leave the launcher window open while you work. Click **Stop and Exit** or close the launcher window to stop the server and any Codex workers it started. Your browser stays open.

To start from a terminal:

1. Open a terminal in the repository root.
2. Run `npm ci`.
3. Run `npm run build` and then `npm start`.
4. Open http://127.0.0.1:3001 in your browser.

For editing, `npm run dev` runs Vite and the API together. The default is local-only; the desktop does not need Electron. This is not a deployed public website.

## Codex connection

All AI generation and text assistance use the local Codex app-server bridge. There is no API-key provider, model picker, browser login form or direct browser access to your Codex credentials. Usage is charged against your signed-in Codex subscription usage and limits; availability of image generation depends on the installed runtime and account.

Install the official Codex runtime and sign in locally with your ChatGPT account before generating. The Windows Codex app runtime is discovered automatically; if needed, set `FOUNDRY_CODEX_PATH` to its absolute executable path on the server. `FOUNDRY_CODEX_TIMEOUT_MS` sets the generation timeout between 600000 and 1800000 ms. Start this web server on the same computer. The provider status and source texture panel report runtime availability and sign-in readiness. They refresh every 15 seconds, on window focus, or when you click Recheck Codex status; signing in does not require restarting the browser. Importing images, local PBR derivation and deterministic recipe export do not require sign-in.

The browser sends requests only to the local Foundry server, which starts Codex through its supported app-server interface. Image-quality controls are prompt instructions, not guaranteed API settings. Review generated assets before use. Legacy saved model selections migrate to Codex automatically; existing source images and historical result metadata are preserved.

## Image Library

Open **Image Library** beside the workflow tabs to browse generated outputs by tab or view all images. Select individual images or use **Select all shown**, then choose **Delete selected** and confirm. Selection carries across categories. Open or download the full-resolution PNG from any card.

The local server saves each completed image, including Action Animator frames and visible Texture Lab edits. Windows stores the library in `%LOCALAPPDATA%\The Foundry\Image Library`. Set `FOUNDRY_IMAGE_LIBRARY_DIR` before launching to use a different local folder.

## Texture to PBR

Generate or import a texture, refine it with the existing expansion, region-edit and seamless finishing controls, then choose a finished texture for PBR. The PBR editor also accepts a standalone approved albedo. Adjust six aligned maps: albedo, normal, roughness, metallic, ambient occlusion and height. Replace any map with an authored image. Choose OpenGL or DirectX normal convention and inspect the tiled sphere/plane preview.

Native square images are uniformly resized to the requested texture canvas before protected-source compositing. For example, a 1254×1254 Codex image can produce a 1024×1024 or 512×512 expansion. The source-preservation mask and seam-finishing layout stay in their original coordinates. Non-square responses fail explicitly rather than silently cropping or stretching reference geometry. Seamless Mode feathers the finish into the surrounding texture, matches opposite tile edges, and softens the join around a preserved source. Use the 3×3 preview to check feature continuity and repetition.

Maps derived from a single color photograph are artistic estimates, not measured physical properties. The editor caps resolution at 2048, cancels stale work, and exports lossless 8-bit PNGs. The ZIP includes individual maps, ORM, Unity HDRP mask, metallic/smoothness, metadata and import notes. Export metadata records normal convention and channel packing.

## Reliable animation and VFX

Action Animator generates 2D sprites only, not a rig or skeletal animation. It slices a row-major landscape grid before scaling and shares one crop/transform across frames to preserve motion. Blank, tiny or clipped cells fail clearly rather than silently exporting broken frames. Its ZIP contains ordered transparent PNGs, atlas.png and animation.json with timing and atlas positions. Visual identity, pose spacing and loop closure still need review.

VFX preserves completed textures when another output fails and exports against the settings that created those textures. The bundle validates image bytes, writes actual PNGs and coherent preview paths, and includes an Editor importer for a Unity URP particle material/prefab. VFX Graph output is explicit manual setup guidance, not a generated `.vfx` asset. Generated C# still needs verification in your target Unity version.

## Security and deployment boundary

This edition is local-only. The server binds to loopback and rejects foreign browser origins. Generation POSTs include an app-specific request header to prevent ordinary cross-site form submissions. Never expose or proxy this server to the public Internet: it runs work using your local Codex account. Credentials remain managed by Codex, not this app. There are no API keys to enter in the browser or `.env`.

## Checks

- `npm test` runs automated unit, mocked API, component and pixel/ZIP regression tests.
- `npm run lint` checks sources.
- `npm run build` typechecks and creates the production client.

The automated suite uses mocked Codex responses. Live generation requires a signed-in local Codex runtime.
