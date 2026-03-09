import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import {
  AnimationClip,
  Bone,
  Object3D,
  SkinnedMesh,
} from 'three'

import type { ModelAsset } from './forge'

const staticMeshOnlyMessage =
  'UV Lab currently supports static OBJ and FBX meshes only. Rigged or animated FBX files are not supported yet.'

export async function loadModelObject(asset: ModelAsset) {
  if (asset.format === 'obj') {
    const text = await asset.file.text()
    return new OBJLoader().parse(text)
  }

  const buffer = await asset.file.arrayBuffer()
  return new FBXLoader().parse(buffer, '')
}

export function validateStaticModelObject(object: Object3D) {
  const clips = getModelAnimationClips(object)

  if (clips.length > 0) {
    throw new Error(staticMeshOnlyMessage)
  }

  let hasUnsupportedContent = false

  object.traverse((child) => {
    if (hasUnsupportedContent) {
      return
    }

    if (child instanceof Bone || child instanceof SkinnedMesh) {
      hasUnsupportedContent = true
      return
    }

    if ('morphTargetInfluences' in child && Array.isArray(child.morphTargetInfluences)) {
      hasUnsupportedContent = true
    }
  })

  if (hasUnsupportedContent) {
    throw new Error(staticMeshOnlyMessage)
  }
}

export function getModelAnimationClips(object: Object3D) {
  const clips =
    (object as Object3D & {
      animations?: AnimationClip[]
    }).animations ?? []

  return Array.isArray(clips) ? clips : []
}
