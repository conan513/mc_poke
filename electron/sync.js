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
  // Add files here that should be blacklisted from the mods folder
]

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

  // Szerver oldalon lévő fájlok halmaza (mappa/fájlnév alapján)
  const serverFileSet = new Set(serverItems.map(m => m.type + '/' + m.filename))


  // Helper: egy mappán belüli összes fájl rekurzív listázása
  function listFilesRecursive(dir, baseDir = dir) {
    const results = []
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          results.push(...listFilesRecursive(fullPath, baseDir))
        } else {
          results.push(path.relative(baseDir, fullPath))
        }
      }
    } catch (_) {}
    return results
  }

  // 1a. TÖRLÉS – state-alapú: ami localState-ben van, de a szerveren már nincs
  for (const key in localState) {
    const info = localState[key]
    const folderFilename = info.type + '/' + (info.filename || path.basename(info.path || ''))
    if (!serverFileSet.has(folderFilename)) {
      if (fs.existsSync(info.path)) {
        fs.unlinkSync(info.path)
        onLog(`[Sync] Törölve (state, nincs a szerveren): ${path.basename(info.path)} (${info.type})`)
      }
      delete localState[key]
    }
  }

  // 1b. TÖRLÉS – fizikai scan: minden szinkronizált mappát végigolvasunk és
  //     törlünk minden fájlt, ami nincs benne a szerver manifestjében.
  //     Ez kezeli azt az esetet, amikor a fájl még nem volt a localState-ben
  //     (pl. modpack telepítésekor kerültek oda, de a szerver azóta eltávolította).
  for (const folder of SYNC_FOLDERS) {
    const folderPath = path.join(instanceDir, folder)
    if (!fs.existsSync(folderPath)) continue
    const localFiles = listFilesRecursive(folderPath)
    for (const relFile of localFiles) {
      const key = folder + '/' + relFile
      if (!serverFileSet.has(key)) {
        const fullPath = path.join(folderPath, relFile)
        try {
          fs.unlinkSync(fullPath)
          onLog(`[Sync] Törölve (scan, nincs a szerveren): ${relFile} (${folder})`)
          // Töröljük a state-ből is, ha ott volt
          const stateKey = relFile + folder
          delete localState[stateKey]
        } catch (e) {
          onLog(`[Sync-Hiba] Nem törölhető: ${relFile} -> ${e.message}`)
        }
      }
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
