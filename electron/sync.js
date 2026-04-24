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
        // Normalizáljuk a szerverről jövő útvonalat ( \ -> / )
        const normalizedFilename = item.filename.replace(/\\/g, '/')
        serverItems.push({ ...item, filename: normalizedFilename, type: folder })
      })
    }
  })

  // Szerver oldalon lévő fájlok halmaza (mappa/fájlnév alapján)
  const serverFileSet = new Set(serverItems.map(m => m.type + '/' + m.filename))

  // Helper: egy mappán belüli összes fájl rekurzív listázása (normalizált utakkal)
  function listFilesRecursive(dir, baseDir = dir) {
    const results = []
    try {
      if (!fs.existsSync(dir)) return []
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          results.push(...listFilesRecursive(fullPath, baseDir))
        } else {
          // Normalizáljuk a helyi útvonalat is
          const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/')
          results.push({ relPath, fullPath })
        }
      }
    } catch (_) {}
    return results
  }

  // 1. TÖRLÉS – Fizikai scan alapú teljes szinkronizáció
  // Végigmegyünk a mappákon és törlünk mindent, ami nincs a szerveren.
  for (const folder of SYNC_FOLDERS) {
    const folderPath = path.join(instanceDir, folder)
    const localFiles = listFilesRecursive(folderPath)
    
    for (const file of localFiles) {
      const key = folder + '/' + file.relPath
      if (!serverFileSet.has(key)) {
        try {
          fs.unlinkSync(file.fullPath)
          onLog(`[Sync] Törölve (nincs a szerveren): ${folder}/${file.relPath}`)
        } catch (e) {
          onLog(`[Sync-Hiba] Nem törölhető: ${folder}/${file.relPath} -> ${e.message}`)
        }
      }
    }
  }

  // 2. LETÖLTÉS / FRISSÍTÉS
  let downloadedCount = 0
  const baseUrl = serverUrl.replace(/\/+$/, '')

  for (const item of serverItems) {
    const filePath = path.join(instanceDir, item.type, item.filename)
    const fullFolderPath = path.dirname(filePath)
    
    if (!fs.existsSync(fullFolderPath)) fs.mkdirSync(fullFolderPath, { recursive: true })
    
    let needsDownload = false
    if (!fs.existsSync(filePath)) {
      needsDownload = true
    } else {
      try {
        const hash = await getHash(filePath)
        if (hash !== item.hash) {
          onLog(`[Sync] Frissítés: ${item.type}/${item.filename}`)
          needsDownload = true
        }
      } catch (e) {
        needsDownload = true
      }
    }

    if (needsDownload) {
      onLog(`[Sync] Letöltés: ${item.type}/${item.filename}`)
      const downloadUrl = `${baseUrl}/${item.type}/${encodeURIComponent(item.filename).replace(/%2F/g, '/')}`
      try {
        await downloadFile(downloadUrl, filePath)
        downloadedCount++
      } catch (e) {
        onLog(`[Sync-Hiba] Hiba a letöltésnél: ${item.type}/${item.filename} -> ${e.message}`)
      }
    }
  }

  // 3. ÜRES MAPPÁK TAKARÍTÁSA
  function cleanEmptyDirs(dir) {
    if (!fs.existsSync(dir)) return
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    if (entries.length === 0) {
      // Ne töröljük a fő szinkron mappákat, csak az almappáikat
      const isBaseFolder = SYNC_FOLDERS.some(f => path.join(instanceDir, f) === dir)
      if (!isBaseFolder) {
        fs.rmdirSync(dir)
        return true
      }
      return false
    }
    
    let allCleared = true
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const wasDeleted = cleanEmptyDirs(path.join(dir, entry.name))
        if (!wasDeleted) allCleared = false
      } else {
        allCleared = false
      }
    }

    if (allCleared) {
      const isBaseFolder = SYNC_FOLDERS.some(f => path.join(instanceDir, f) === dir)
      if (!isBaseFolder) {
        fs.rmdirSync(dir)
        return true
      }
    }
    return false
  }

  SYNC_FOLDERS.forEach(f => cleanEmptyDirs(path.join(instanceDir, f)))

  // 4. Állapot mentése (opcionális, de a manifestet eltárolhatjuk későbbre)
  fs.writeFileSync(stateFile, JSON.stringify({ lastSync: new Date().toISOString(), serverUrl }, null, 2))
  
  if (downloadedCount > 0) {
    onLog(`[Sync] Szinkronizáció kész! Frissítve: ${downloadedCount} fájl.`)
  } else {
    onLog(`[Sync] Minden fájl naprakész.`)
  }
}

module.exports = { syncServerMods }
