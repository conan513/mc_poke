const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const http = require('http')
const https = require('https')

function getHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, { headers: { 'User-Agent': 'CobbleLauncher/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        return downloadFile(res.headers.location, dest, onProgress).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      const total = parseInt(res.headers['content-length'] || '0', 10)
      let downloaded = 0
      const file = fs.createWriteStream(dest)
      res.on('data', chunk => {
        downloaded += chunk.length
        if (total > 0 && onProgress) onProgress(downloaded / total)
      })
      res.pipe(file)
      file.on('finish', () => file.close(resolve))
      file.on('error', reject)
    })
    req.on('error', reject)
  })
}

function fetchManifest(serverUrl) {
  return new Promise((resolve, reject) => {
    const manifestUrl = `${serverUrl.replace(/\/+$/, '')}/manifest`
    const mod = manifestUrl.startsWith('https') ? https : http
    mod.get(manifestUrl, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`Szerver hiba: ${res.statusCode}`))
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch(e) { reject(e) }
      })
    }).on('error', reject)
  })
}

// List of files that should ALWAYS be removed from the mods folder if they exist.
// This runs even if the sync server is unreachable.
const FORCED_REMOVALS = [
  'DefaultOptions-Fabric-1.21.1-20.0.1.jar', // Example: mod that keeps adding sponsor servers
  'SponsorMod.jar', // Placeholder for other unwanted mods
]

/**
 * Szinkronizálja a mods mappát a megadott szerverrel.
 * @param {string} serverUrl A szerver címe (pl. http://localhost:7878)
 * @param {string} modsDir A mods mappa elérési útja
 * @param {function} onLog Logoló callback
 */
async function syncServerMods(serverUrl, modsDir, onLog) {
  // 0. Forced cleanup (runs even if no serverUrl or if server is offline)
async function syncServerMods(serverUrl, instanceDir, onLog) {
  if (!serverUrl || serverUrl.trim() === '') return

  onLog(`[Sync] Kapcsolódás a szerverhez: ${serverUrl}`)
  
  let manifest
  try {
    manifest = await fetchManifest(serverUrl)
  } catch (err) {
    onLog(`[Sync-Hiba] Nem sikerült lekérni a manifestet: ${err.message}`)
    return
  }

  const stateFile = path.join(instanceDir, '.server-sync-state.json')
  let localState = {} // { filename: { path: string, type: string } }
  try {
    if (fs.existsSync(stateFile)) {
      localState = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    }
  } catch (e) {
    onLog('[Sync] Állapotfájl hiba, újraépítés...')
  }

  // Összegyűjtjük a szerver aktuális fájljait dinamikusan a manifest alapján
  const SYNC_FOLDERS = ['mods', 'datapacks', 'config', 'resourcepacks', 'shaderpacks']
  const serverItems = []
  
  SYNC_FOLDERS.forEach(folder => {
    if (manifest[folder] && Array.isArray(manifest[folder])) {
      manifest[folder].forEach(item => {
        serverItems.push({ ...item, type: folder })
      })
    }
  })

  const serverFilenames = serverItems.map(m => m.filename + m.type) // unique key

  // 1. TÖRLÉS: Ami a localState-ben benne van, de a szerveren már nincs
  for (const key in localState) {
    if (!serverFilenames.includes(key)) {
      const info = localState[key]
      if (fs.existsSync(info.path)) {
        fs.unlinkSync(info.path)
        onLog(`[Sync] Törölve (már nincs a szerveren): ${path.basename(info.path)} (${info.type})`)
      }
      delete localState[key]
    }
  }

  // 2. LETÖLTÉS / FRISSÍTÉS
  let downloadedCount = 0
  const baseUrl = serverUrl.replace(/\/+$/, '')

  for (const item of serverItems) {
    const fullFolderPath = path.join(instanceDir, item.type, path.dirname(item.filename))
    if (!fs.existsSync(fullFolderPath)) fs.mkdirSync(fullFolderPath, { recursive: true })
    
    const filePath = path.join(instanceDir, item.type, item.filename)
    const stateKey = item.filename + item.type
    let needsDownload = false

    if (!fs.existsSync(filePath)) {
      needsDownload = true
    } else {
      const hash = await getHash(filePath)
      if (hash !== item.hash) {
        onLog(`[Sync] Változás: ${item.filename} (${item.type})`)
        needsDownload = true
      }
    }

    if (needsDownload) {
      onLog(`[Sync] Letöltés: ${item.filename}`)
      const downloadUrl = `${baseUrl}/${item.type}/${encodeURIComponent(item.filename)}`
      try {
        await downloadFile(downloadUrl, filePath)
        localState[stateKey] = { path: filePath, type: item.type }
        downloadedCount++
      } catch (e) {
        onLog(`[Sync-Hiba] Hiba: ${item.filename} -> ${e.message}`)
      }
    } else {
      if (!localState[stateKey]) {
        localState[stateKey] = { path: filePath, type: item.type }
      }
    }
  }

  // 3. Mentés
  fs.writeFileSync(stateFile, JSON.stringify(localState, null, 2))
  
  if (downloadedCount > 0) {
    onLog(`[Sync] Szinkronizáció kész! Frissítve: ${downloadedCount} fájl.`)
  } else {
    onLog(`[Sync] Minden fájl naprakész.`)
  }
}

module.exports = { syncServerMods }
