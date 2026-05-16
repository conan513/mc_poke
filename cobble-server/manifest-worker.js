'use strict'
/**
 * manifest-worker.js
 * ─────────────────────────────────────────────────────────────
 * Worker thread a manifest (fájl hash) számításhoz.
 * Fogad: { type: 'build', dirs: { <folder>: <path> }, syncFolders: string[] }
 * Küld:  { type: 'result', manifest } | { type: 'error', message }
 *
 * A SHA256 hash-számítás CPU-intenzív munka – ez a thread izolálva tartja
 * a főszál event loop-ját (Minecraft STDIN/STDOUT) attól.
 */

const { parentPort } = require('worker_threads')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const fp = fs.promises

async function getFilesRecursive(dir, baseDir = dir) {
  let results = []
  try {
    const list = await fp.readdir(dir)
    for (const file of list) {
      const fullPath = path.join(dir, file)
      const stat = await fp.stat(fullPath)
      if (stat && stat.isDirectory()) {
        results = results.concat(await getFilesRecursive(fullPath, baseDir))
      } else {
        results.push(path.relative(baseDir, fullPath))
      }
    }
  } catch {
    return []
  }
  return results
}

async function mapFiles(files, dir) {
  const result = []
  for (const relPath of files) {
    try {
      const buf = await fp.readFile(path.join(dir, relPath))
      const hash = crypto.createHash('sha256').update(buf).digest('hex')
      result.push({ filename: relPath, hash, size: buf.length })
    } catch {
      /* kihagyjuk ha a fájl közben törlődött */
    }
  }
  return result
}

parentPort.on('message', async ({ type, dirs, syncFolders }) => {
  if (type !== 'build') return

  try {
    const manifest = {
      generatedAt: new Date().toISOString(),
      serverVersion: '1.3',
      folders: {}
    }

    for (const f of syncFolders) {
      const files = await getFilesRecursive(dirs[f])
      manifest[f] = await mapFiles(files, dirs[f])
      manifest.folders[f] = manifest[f].length
    }

    if (dirs['client-mods']) {
      const clientFiles = await getFilesRecursive(dirs['client-mods'])
      const mappedClientMods = await mapFiles(clientFiles, dirs['client-mods'])
      if (!manifest['mods']) manifest['mods'] = []
      manifest['mods'] = manifest['mods'].concat(mappedClientMods)
      manifest.folders['mods'] = manifest['mods'].length
    }

    const allMods = manifest['mods'] || []
    manifest.modCount = allMods.filter(f => f.filename.endsWith('.jar')).length

    parentPort.postMessage({ type: 'result', manifest })
  } catch (err) {
    parentPort.postMessage({ type: 'error', message: err.message })
  }
})
