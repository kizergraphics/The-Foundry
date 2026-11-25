import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import express from 'express'
import sharp from 'sharp'
import { isForgeMode } from '../shared/modeCatalog.js'

const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function createImageLibrary(root = process.env.FOUNDRY_IMAGE_LIBRARY_DIR ||
  path.join(process.env.LOCALAPPDATA || path.join(homedir(), '.local', 'share'), 'The Foundry', 'Image Library')) {
  const directory = path.resolve(root)

  async function save({ mode, images, prompt = '', title, createdAt = new Date().toISOString() }) {
    if (!isForgeMode(mode)) throw new Error('Unknown image library mode.')
    await fs.mkdir(directory, { recursive: true })

    // A directory becomes visible only after its image, thumbnail, and metadata are ready.
    const entries = []
    const failures = []
    for (const [index, image] of images.entries()) {
      const id = randomUUID()
      const entry = {
        id, mode, createdAt,
        title: (image.title || title || prompt || mode).trim().replace(/\s+/g, ' ').slice(0, 110),
        prompt: (image.text || prompt).trim().slice(0, 8000),
        fileName: `${mode}-${id.slice(0, 8)}.png`,
      }
      if (images.length > 1 && !image.title) entry.title += ` · ${index + 1}`
      let staging
      try {
        staging = await fs.mkdtemp(path.join(directory, '.saving-'))
        const buffer = Buffer.from(image.data, 'base64')
        await sharp(buffer).resize(384, 384, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 84 }).toFile(path.join(staging, 'thumbnail.webp'))
        await fs.writeFile(path.join(staging, 'image.png'), buffer)
        await fs.writeFile(path.join(staging, 'entry.json'), JSON.stringify(entry))
        await fs.rename(staging, path.join(directory, id))
        entries.push(entry)
      } catch (error) {
        if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
        failures.push(error)
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Some generated images could not be saved.')
    return entries
  }

  async function list() {
    let children
    try {
      children = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
    const entries = []
    for (const child of children) {
      if (!child.isDirectory() || !validId.test(child.name)) continue
      try {
        const entry = JSON.parse(await fs.readFile(path.join(directory, child.name, 'entry.json'), 'utf8'))
        entries.push(entry)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        // Another request may have deleted this entry after the directory listing.
      }
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async function remove(ids) {
    const failed = []
    for (const id of new Set(ids)) {
      if (!validId.test(id)) throw new Error('Invalid image library ID.')
      const removed = path.join(directory, `.removing-${id}-${randomUUID()}`)
      try {
        await fs.rename(path.join(directory, id), removed)
      } catch (error) {
        if (error.code !== 'ENOENT') failed.push(id)
        continue
      }
      try {
        await fs.rm(removed, { recursive: true, force: true, maxRetries: 3 })
      } catch (error) {
        console.error('Could not clean up a deleted image library entry.', error.code)
      }
    }
    return failed
  }

  return { directory, save, list, remove }
}

export function createImageLibraryRouter(library) {
  const router = express.Router()
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store')
    next()
  })
  router.get('/', async (_request, response) => {
    response.json({ images: await library.list() })
  })
  router.get('/:id/:asset', (request, response, next) => {
    const { id, asset } = request.params
    if (!validId.test(id) || !['image.png', 'thumbnail.webp'].includes(asset)) {
      response.sendStatus(404)
      return
    }
    response.sendFile(path.join(library.directory, id, asset), { cacheControl: false }, error => {
      if (!error) return
      if (error.status === 404 && !response.headersSent) response.sendStatus(404)
      else next(error)
    })
  })
  router.post('/delete', express.json({ limit: '1mb' }), async (request, response) => {
    const ids = request.body?.ids
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !validId.test(id))) {
      response.status(400).json({ error: 'Select valid images to delete.' })
      return
    }
    const failed = await library.remove(ids)
    if (failed.length) {
      response.status(500).json({ error: 'Some images could not be deleted. Try selecting them again.' })
      return
    }
    response.sendStatus(204)
  })
  return router
}
