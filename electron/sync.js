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
    const request = (targetUrl) => {
      const mod = targetUrl.startsWith('https') ? https : http
      mod.get(targetUrl, { headers: { 'User-Agent': 'CobbleLauncher/1.0' } }, (res) => {
        // Follow redirects (301, 302, 307, 308)
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          return request(res.headers.location)
        }
        if (res.statusCode !== 200) return reject(new Error(`Szerver hiba: ${res.statusCode}`))
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch(e) { reject(e) }
        })
        res.on('error', reject)
      }).on('error', reject)
    }
    request(`${serverUrl.replace(/\/+$/, '')}/manifest`)
  })
}

// List of files that should ALWAYS be removed from the mods folder if they exist.
// This runs even if the sync server is unreachable.
const FORCED_REMOVALS = [
  'custom-splash-screen', 'customsplashscreen', 'soundsbegone', 
  'interactic', 'fancymenu', 'konkrete', 'drippyloadingscreen', 'loadingscreen', 'notenoughcrashes',
  'zombified-player', 'zombifiedplayer', 'squaremap', 'ordered-player-list', 'player-mobs', 'maplink',
  'pneumono_gravestones', 'pneumono_core'
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

  // Helper: Blacklist check
  function isBlacklisted(folder, filename) {
    const fullKey = (folder + '/' + filename).toLowerCase()
    return FORCED_REMOVALS.some(blacklisted => fullKey.includes(blacklisted.toLowerCase()))
  }

  // 1. TÖRLÉS – Fizikai scan alapú szinkronizáció
  // Meghatározzuk, mely mappákban/útvonalakon kötelező a teljes egyezés (törlés)
  const FULL_SYNC_FOLDERS = ['mods', 'datapacks']

  // Előző sync-ből maradt .disabled fájlok takarítása (Windows zárolási fallback)
  for (const folder of FULL_SYNC_FOLDERS) {
    const folderPath = path.join(instanceDir, folder)
    const allFiles = listFilesRecursive(folderPath)
    for (const file of allFiles) {
      if (file.relPath.endsWith('.disabled')) {
        try {
          fs.unlinkSync(file.fullPath)
          onLog(`[Sync] Régi .disabled fájl törölve: ${folder}/${file.relPath}`)
        } catch (_) {}
      }
    }
  }
  
  for (const folder of SYNC_FOLDERS) {
    const folderPath = path.join(instanceDir, folder)
    const localFiles = listFilesRecursive(folderPath)
    
    for (const file of localFiles) {
      const key = folder + '/' + file.relPath
      
      // Akkor törlünk, ha:
      // 1. Nincs a szerveren a fájl (és a mappa FULL_SYNC-ben van)
      // VAGY
      // 2. A fájl feketelistán van
      const blacklisted = isBlacklisted(folder, file.relPath)
      if (!serverFileSet.has(key) || blacklisted) {
        let shouldDelete = FULL_SYNC_FOLDERS.includes(folder) || blacklisted

        if (shouldDelete) {
          try {
            fs.unlinkSync(file.fullPath)
            onLog(`[Sync] Törölve ${blacklisted ? '(feketelista)' : '(nincs a szerveren)'}: ${folder}/${file.relPath}`)
          } catch (e) {
            // Windows: EPERM/EBUSY = fájl zárolt (antivírus, Minecraft process stb.)
            // Átnevezzük .del kiterjesztésre, így legalább nem töltődik be a játékba
            if (e.code === 'EPERM' || e.code === 'EBUSY') {
              try {
                const disabledPath = file.fullPath + '.disabled'
                fs.renameSync(file.fullPath, disabledPath)
                onLog(`[Sync] Átnevezve (fájl zárolt, törlés helyett): ${folder}/${file.relPath} -> .disabled`)
              } catch (renameErr) {
                onLog(`[Sync-Hiba] Nem törölhető és nem nevezhető át (fájl zárolt): ${folder}/${file.relPath} -> ${e.message}`)
              }
            } else {
              onLog(`[Sync-Hiba] Nem törölhető: ${folder}/${file.relPath} -> ${e.message}`)
            }
          }
        }
      }
    }
  }

  // 2. LETÖLTÉS / FRISSÍTÉS
  let downloadedCount = 0
  const baseUrl = serverUrl.replace(/\/+$/, '')

  for (const item of serverItems) {
    // Feketelista ellenőrzése letöltés előtt
    if (isBlacklisted(item.type, item.filename)) {
      // onLog(`[Sync] Kihagyva (feketelista): ${item.type}/${item.filename}`)
      continue
    }

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

  SYNC_FOLDERS.forEach(f => {
    const p = path.join(instanceDir, f)
    if (fs.existsSync(p)) {
      cleanEmptyDirs(p)
    }
  })

  // 4. Állapot mentése (opcionális, de a manifestet eltárolhatjuk későbbre)
  fs.writeFileSync(stateFile, JSON.stringify({ lastSync: new Date().toISOString(), serverUrl }, null, 2))
  
  if (downloadedCount > 0) {
    onLog(`[Sync] Szinkronizáció kész! Frissítve: ${downloadedCount} fájl.`)
  } else {
    onLog(`[Sync] Minden fájl naprakész.`)
  }
}

module.exports = { syncServerMods }
