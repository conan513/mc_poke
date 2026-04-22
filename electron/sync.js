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

/**
 * Szinkronizálja a mods mappát a megadott szerverrel.
 * @param {string} serverUrl A szerver címe (pl. http://localhost:7878)
 * @param {string} modsDir A mods mappa elérési útja
 * @param {function} onLog Logoló callback
 */
async function syncServerMods(serverUrl, modsDir, onLog) {
  if (!serverUrl) return

  onLog(`[Sync] Kapcsolódás a szerverhez: ${serverUrl}`)
  
  let manifest
  try {
    manifest = await fetchManifest(serverUrl)
  } catch (err) {
    onLog(`[Sync-Hiba] Nem sikerült lekérni a szerver modokat: ${err.message}`)
    return
  }

  const serverMods = manifest.mods || []
  onLog(`[Sync] Szerveren talált modok: ${serverMods.length} db`)

  const stateFile = path.join(modsDir, '.server-mods-state.json')
  let localState = []
  try {
    if (fs.existsSync(stateFile)) {
      localState = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    }
  } catch (e) {
    onLog('[Sync] Állapotfájl hiba, újraépítés...')
  }

  const currentServerFilenames = serverMods.map(m => m.filename)

  // 1. Töröljük azokat, amiket a szerverről szedtünk le régen, de már nincsenek ott
  for (const filename of localState) {
    if (!currentServerFilenames.includes(filename)) {
      const filePath = path.join(modsDir, filename)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        onLog(`[Sync] Törölve (már nincs a szerveren): ${filename}`)
      }
    }
  }

  // 2. Letöltjük az új vagy módosult modokat
  let downloadedCount = 0
  const baseUrl = serverUrl.replace(/\/+$/, '')

  for (const mod of serverMods) {
    const filePath = path.join(modsDir, mod.filename)
    let needsDownload = false

    if (!fs.existsSync(filePath)) {
      needsDownload = true
    } else {
      const hash = await getHash(filePath)
      if (hash !== mod.hash) {
        onLog(`[Sync] Fájl változott, frissítés: ${mod.filename}`)
        needsDownload = true
      }
    }

    if (needsDownload) {
      onLog(`[Sync] Letöltés: ${mod.filename} (${Math.round(mod.size / 1024)} KB)`)
      const downloadUrl = `${baseUrl}/mods/${encodeURIComponent(mod.filename)}`
      try {
        await downloadFile(downloadUrl, filePath)
        downloadedCount++
      } catch (e) {
        onLog(`[Sync-Hiba] Nem sikerült letölteni: ${mod.filename} -> ${e.message}`)
      }
    }
  }

  // 3. Elmentjük az új állapotot
  fs.writeFileSync(stateFile, JSON.stringify(currentServerFilenames, null, 2))

  if (downloadedCount > 0) {
    onLog(`[Sync] Szinkronizáció kész! Frissült/Letöltve: ${downloadedCount} mod.`)
  } else {
    onLog(`[Sync] Minden szerver mod naprakész.`)
  }
}

module.exports = { syncServerMods }
