const fs = require('fs')
const fse = require('fs-extra')
const path = require('path')
const https = require('https')
const http = require('http')
const crypto = require('crypto')
const { exec, execFile } = require('child_process')
const AdmZip = require('adm-zip')

const MODPACK_PROJECT_ID = 'Jkb29YJU'
const MC_VERSION = '1.21.1'
const MODRINTH_VERSIONS_URL = `https://api.modrinth.com/v2/project/${MODPACK_PROJECT_ID}/version?loaders=["fabric"]&game_versions=["${MC_VERSION}"]`
const FABRIC_META_URL = `https://meta.fabricmc.net/v2/versions/loader/${MC_VERSION}`
const FABRIC_INSTALLER_META_URL = 'https://meta.fabricmc.net/v2/versions/installer'

const SERVER_DIR = path.join(__dirname, 'server-data')
const MODS_DIR = path.join(SERVER_DIR, 'mods')

const JAVA_URLS = {
  linux_x64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_x64_linux_hotspot_21.0.5_11.tar.gz',
  linux_arm64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_aarch64_linux_hotspot_21.0.5_11.tar.gz',
  win32_x64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_x64_windows_hotspot_21.0.5_11.zip',
  darwin_x64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_x64_mac_hotspot_21.0.5_11.tar.gz',
  darwin_arm64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_aarch64_mac_hotspot_21.0.5_11.tar.gz',
}

function getJavaExecutable() {
  const javaDir = path.join(SERVER_DIR, 'java21')
  if (process.platform === 'win32') return path.join(javaDir, 'bin', 'java.exe')
  if (process.platform === 'darwin') return path.join(javaDir, 'Contents', 'Home', 'bin', 'java')
  return path.join(javaDir, 'bin', 'java')
}


async function installJava() {
  const javaDir = path.join(SERVER_DIR, 'java21')
  const javaExe = getJavaExecutable()

  if (fs.existsSync(javaExe)) {
    console.log('[Java] Java 21 már telepítve.')
    return javaExe
  }

  const platform = process.platform
  const arch = process.arch
  const key = `${platform}_${arch === 'arm64' ? 'arm64' : 'x64'}`
  const url = JAVA_URLS[key] || JAVA_URLS[`${platform}_x64`]

  if (!url) throw new Error(`Nem támogatott platform Java letöltéshez: ${platform} ${arch}`)

  console.log(`[Java] Java 21 letöltése (${platform} ${arch})...`)
  const ext = url.endsWith('.zip') ? '.zip' : '.tar.gz'
  const javaDl = path.join(SERVER_DIR, `java21${ext}`)

  await downloadFile(url, javaDl, (p) => {
    process.stdout.write(`\r[Java] Letöltés: ${Math.round(p * 100)}%`)
  })
  console.log('\n[Java] Java 21 kicsomagolása...')

  fs.mkdirSync(javaDir, { recursive: true })

  if (ext === '.zip') {
    const zip = new AdmZip(javaDl)
    zip.extractAllTo(javaDir, true)
  } else {
    await new Promise((resolve, reject) => {
      execFile('tar', ['-xzf', javaDl, '-C', javaDir, '--strip-components=1'], (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  fs.unlinkSync(javaDl)

  // After extraction, the layout for the JDK may include a top-level directory
  // (e.g. "jdk-21.0.5+11/") which means javaExe may not exist at the
  // expected path. Try to locate the real executable in common locations.
  function findJavaExecutableFromDir(dir) {
    // Direct expected paths
    const candidates = []
    if (process.platform === 'win32') {
      candidates.push(path.join(dir, 'bin', 'java.exe'))
    } else if (process.platform === 'darwin') {
      candidates.push(path.join(dir, 'Contents', 'Home', 'bin', 'java'))
      candidates.push(path.join(dir, 'bin', 'java'))
    } else {
      candidates.push(path.join(dir, 'bin', 'java'))
    }

    for (const c of candidates) if (fs.existsSync(c)) return c

    // Search one level deep for a folder that contains bin/java
    try {
      const entries = fs.readdirSync(dir)
      for (const e of entries) {
        const candidateDir = path.join(dir, e)
        for (const c of candidates) {
          const cand = c.replace(dir + path.sep, path.join(candidateDir, ''))
          if (fs.existsSync(cand)) return cand
        }
        // check candidateDir/bin/java(.exe)
        const alt = process.platform === 'win32'
          ? path.join(candidateDir, 'bin', 'java.exe')
          : path.join(candidateDir, 'bin', 'java')
        if (fs.existsSync(alt)) return alt
        if (process.platform === 'darwin') {
          const alt2 = path.join(candidateDir, 'Contents', 'Home', 'bin', 'java')
          if (fs.existsSync(alt2)) return alt2
        }
      }
    } catch (e) {
      // ignore
    }
    // Fallback to original expected path
    return candidates[0]
  }

  const resolvedJavaExe = findJavaExecutableFromDir(javaDir)
  if (!fs.existsSync(resolvedJavaExe)) {
    throw new Error(`Java executable not found after extraction: ${resolvedJavaExe}`)
  }

  if (process.platform !== 'win32') fs.chmodSync(resolvedJavaExe, 0o755)
  console.log('[Java] Java 21 telepítése sikeres.')
  return resolvedJavaExe
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const request = (targetUrl) => {
      const mod = targetUrl.startsWith('https') ? https : http
      mod.get(targetUrl, { headers: { 'User-Agent': 'CobbleServer/1.0' } }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode)) return request(res.headers.location)
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`))
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
      }).on('error', reject)
    }
    request(url)
  })
}

/**
 * Calculates a file hash (default SHA1 for Modrinth).
 */
function getFileHash(filePath, algorithm = 'sha1') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm)
    const stream = fs.createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/**
 * Generic Modrinth API request helper.
 */
async function modrinthRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.modrinth.com',
      path: path,
      method: method,
      headers: {
        'User-Agent': 'CobbleServer/1.0',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      }
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          if (res.statusCode >= 400) {
            console.error(`[Modrinth-API] Error ${res.statusCode} on ${path}: ${data}`)
            return reject(new Error(`Modrinth API hiba: ${res.statusCode}`))
          }
          resolve(JSON.parse(data))
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

/**
 * Scans the mods folder and checks Modrinth for newer versions
 * compatible with the current MC version and Fabric.
 */
async function updateModsFromModrinth() {
  if (!fs.existsSync(MODS_DIR)) {
    console.log('[Modrinth] Mods mappa nem létezik, kihagyás.');
    return;
  }

  console.log('[Modrinth] Modok frissítéseinek ellenőrzése (MC 1.21.1)...');

  try {
    const files = fs.readdirSync(MODS_DIR).filter(f => f.endsWith('.jar'));
    console.log(`[Modrinth] ${files.length} .jar fájl találva a mods mappában.`);
    
    const hashes = [];
    const fileToInfo = {};

    for (const file of files) {
      const fullPath = path.join(MODS_DIR, file);
      try {
        const hash = await getFileHash(fullPath, 'sha1');
        hashes.push(hash);
        fileToInfo[hash] = { file, fullPath };
      } catch (e) {
        console.warn(`[Modrinth] Hiba a hash kiszámításakor (${file}): ${e.message}`);
      }
    }

    if (hashes.length === 0) {
      console.log('[Modrinth] Nem sikerült hash-elni egyetlen fájlt sem.');
      return;
    }

    console.log(`[Modrinth] Azonosítás a Modrinth API-val...`);
    const versionMap = await modrinthRequest('/v2/version_files', 'POST', {
      hashes: hashes,
      algorithm: 'sha1'
    });

    const projectsToCheck = new Set();
    const hashToVersion = {};
    for (const hash in versionMap) {
      const v = versionMap[hash];
      hashToVersion[hash] = v;
      projectsToCheck.add(v.project_id);
    }

    console.log(`[Modrinth] ${projectsToCheck.size} projekt azonosítva a Modrinth-en.`);

    let updatedCount = 0;
    for (const projectId of projectsToCheck) {
      try {
        const query = `loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(`["${MC_VERSION}"]`)}`
        const versions = await modrinthRequest(`/v2/project/${projectId}/version?${query}`);
        const releases = versions.filter(v => v.version_type === 'release');
        const latest = releases[0] || versions[0];
        
        if (!latest) {
          console.log(`[Modrinth] Nincs kompatibilis verzió a projekthez: ${projectId}`);
          continue;
        }

        const currentVersionsForProject = Object.values(hashToVersion).filter(v => v.project_id === projectId);
        
        // Find if any local version of this project is older than the latest version
        const needsUpdate = currentVersionsForProject.some(v => {
            const currentDate = new Date(v.date_published);
            const latestDate = new Date(latest.date_published);
            return latestDate > currentDate;
        });

        if (needsUpdate) {
          const newestFile = latest.files.find(f => f.primary) || latest.files[0];
          const oldVersion = currentVersionsForProject[0];
          const oldHash = Object.keys(hashToVersion).find(h => hashToVersion[h].id === oldVersion.id);
          const oldFileInfo = fileToInfo[oldHash];

          if (oldFileInfo) {
            console.log(`[Modrinth] FRISSÍTÉS: ${oldFileInfo.file} -> ${newestFile.filename} (${latest.version_number})`);
            const dest = path.join(MODS_DIR, newestFile.filename);
            
            await downloadFile(newestFile.url, dest);
            if (fs.existsSync(oldFileInfo.fullPath) && oldFileInfo.fullPath !== dest) {
              fs.unlinkSync(oldFileInfo.fullPath);
            }
            updatedCount++;
          }
        }
      } catch (e) {
        console.error(`[Modrinth-Hiba] Hiba a projekt ellenőrzésekor (${projectId}): ${e.message}`);
      }
    }

    if (updatedCount > 0) {
      console.log(`[Modrinth] Szinkronizáció kész! ${updatedCount} mod frissítve.`);
    } else {
      console.log('[Modrinth] Minden mod naprakész.');
    }
  } catch (err) {
    console.error(`[Modrinth-Hiba] Végzetes hiba az ellenőrzés során: ${err.message}`);
  }
}

/**
 * Ensures specific extra mods are present.
 */
async function ensureExtraMods() {
  const extraMods = ['chipped', 'terrablender'];
  console.log(`[Modrinth] Extra modok ellenőrzése: ${extraMods.join(', ')}...`);

  for (const slug of extraMods) {
    try {
      const query = `loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(`["${MC_VERSION}"]`)}`
      const versions = await modrinthRequest(`/v2/project/${slug}/version?${query}`);
      const latest = versions.filter(v => v.version_type === 'release')[0] || versions[0];
      
      if (!latest) continue;

      const file = latest.files.find(f => f.primary) || latest.files[0];
      const dest = path.join(MODS_DIR, file.filename);

      const files = fs.readdirSync(MODS_DIR);
      const isPresent = files.some(f => f.toLowerCase().includes(slug.toLowerCase()));
      
      if (!isPresent) {
        console.log(`[Modrinth] Extra mod letöltése: ${slug} -> ${file.filename}`);
        await downloadFile(file.url, dest);
      }
    } catch (e) {
      console.error(`[Modrinth-Hiba] Extra mod hiba (${slug}): ${e.message}`);
    }
  }
}

/**
 * Removes any mods that are on the blacklist from the mods folder.
 */
async function cleanupBlacklistedMods() {
  const blacklist = ['no hunger', 'mobsbegone', 'no ender dragon', 'soundsbegone', 'interactic', 'custom-splash-screen', 'customsplashscreen'];
  if (fs.existsSync(MODS_DIR)) {
    const files = fs.readdirSync(MODS_DIR);
    for (const file of files) {
      const lower = file.toLowerCase();
      if (blacklist.some(b => lower.includes(b))) {
        console.log(`[Installer] Feketelistás mod törlése: ${file}`);
        try {
          fs.unlinkSync(path.join(MODS_DIR, file));
        } catch (e) {
          console.warn(`[Installer-Hiba] Nem sikerült törölni a feketelistás modot (${file}): ${e.message}`);
        }
      }
    }
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = (targetUrl) => {
      const mod = targetUrl.startsWith('https') ? https : http
      mod.get(targetUrl, { headers: { 'User-Agent': 'CobbleServer/1.0' } }, res => {
        if ([301, 302].includes(res.statusCode)) return request(res.headers.location)
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
        })
        res.on('error', reject)
      }).on('error', reject)
    }
    request(url)
  })
}

async function getLatestFabric() {
  const loaders = await fetchJson(FABRIC_META_URL)
  const stableLoaders = loaders.filter(l => l.loader?.stable !== false)
  const loader = stableLoaders[0].loader.version

  const installers = await fetchJson(FABRIC_INSTALLER_META_URL)
  const stableInsts = installers.filter(i => i.stable !== false)
  const installer = stableInsts[0].version

  return { loader, installer }
}

async function install() {
  console.log('[Installer] Indítás...')

  // 0. Java 21
  const javaPath = await installJava()

  fs.mkdirSync(MODS_DIR, { recursive: true })

  // 1. Modpack check & download
  console.log('[Installer] Keresem a legfrissebb Cobbleverse modpackot...')
  const versions = await fetchJson(MODRINTH_VERSIONS_URL)
  const latestPack = versions.filter(v => v.version_type === 'release')[0] || versions[0]
  const file = latestPack.files.find(f => f.primary) || latestPack.files[0]
  const stateFile = path.join(SERVER_DIR, '.server-install-state.json')

  let state = {}
  if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))

  if (state.modpackId === latestPack.id) {
    console.log(`[Installer] Modpack (${latestPack.version_number}) már telepítve.`)
  } else {
    console.log(`[Installer] Új modpack telepítése: ${latestPack.version_number}`)
    const mrpackPath = path.join(SERVER_DIR, 'modpack.mrpack')

    // Clean old mods to prevent conflicts
    if (fs.existsSync(MODS_DIR)) {
      fs.readdirSync(MODS_DIR).forEach(f => {
        if (f.endsWith('.jar') || f.endsWith('.zip')) fs.unlinkSync(path.join(MODS_DIR, f))
      })
    }

    await downloadFile(file.url, mrpackPath, p => {
      process.stdout.write(`\r[Installer] Modpack letöltése: ${Math.round(p * 100)}%`)
    })
    console.log('\n[Installer] Kicsomagolás...')

    const zip = new AdmZip(mrpackPath)
    const index = JSON.parse(zip.readAsText('modrinth.index.json'))

    // Extract overrides (prioritize server-overrides, then overrides)
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue
      const lowerName = entry.entryName.toLowerCase()
      if (lowerName.includes('no hunger') || lowerName.includes('mobsbegone') || lowerName.includes('no ender dragon') || lowerName.includes('soundsbegone') || lowerName.includes('interactic') || lowerName.includes('custom-splash-screen') || lowerName.includes('customsplashscreen')) continue

      let destPath = null
      if (entry.entryName.startsWith('server-overrides/')) {
        destPath = path.join(SERVER_DIR, entry.entryName.slice('server-overrides/'.length))
      } else if (entry.entryName.startsWith('overrides/')) {
        // Only extract normal overrides if it doesn't already exist (server-overrides might have placed it)
        const checkPath = path.join(SERVER_DIR, entry.entryName.slice('overrides/'.length))
        if (!fs.existsSync(checkPath)) destPath = checkPath
      }
      if (destPath) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true })
        fs.writeFileSync(destPath, entry.getData())
      }
    }

    // Download mods that are NOT client-only and filter out unwanted mods
    const files = index.files || []
    const serverFiles = files.filter(f => {
      if (f.env && f.env.server === 'unsupported') return false
      const lowerPath = f.path.toLowerCase()
      if (lowerPath.includes('no hunger') || lowerPath.includes('mobsbegone') || lowerPath.includes('no ender dragon') || lowerPath.includes('soundsbegone') || lowerPath.includes('interactic') || lowerPath.includes('custom-splash-screen') || lowerPath.includes('customsplashscreen')) return false
      return true
    })
    console.log(`[Installer] Szerver modok letöltése (${serverFiles.length} db)...`)

    const baseFilenames = []
    let done = 0
    for (let i = 0; i < serverFiles.length; i += 5) {
      const batch = serverFiles.slice(i, i + 5)
      await Promise.all(batch.map(async f => {
        const dest = path.join(SERVER_DIR, f.path)
        baseFilenames.push(path.basename(f.path))
        const downloadUrl = f.downloads?.[0]
        if (downloadUrl) {
          await downloadFile(downloadUrl, dest).catch(() => { })
        }
        done++
      }))
      process.stdout.write(`\r[Installer] Modok: ${done}/${serverFiles.length}`)
    }
    console.log()

    // Save base modpack filenames so the Admin UI doesn't touch them
    fs.writeFileSync(path.join(SERVER_DIR, '.modpack-files.json'), JSON.stringify(baseFilenames, null, 2))

    fs.unlinkSync(mrpackPath)
    state.modpackId = latestPack.id
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
  }

  // 2. Fabric Server Install
  const fv = await getLatestFabric()
  const launchJar = path.join(SERVER_DIR, 'fabric-server-launch.jar')

  if (state.fabricLoader !== fv.loader || !fs.existsSync(launchJar)) {
    console.log(`[Installer] Fabric Server ${fv.loader} telepítése...`)
    const installerJar = path.join(SERVER_DIR, 'fabric-installer.jar')
    const installerUrl = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${fv.installer}/fabric-installer-${fv.installer}.jar`
    await downloadFile(installerUrl, installerJar)

    await new Promise((resolve, reject) => {
      // Pass explicit -dir on Windows and other platforms to ensure the
      // Fabric installer writes files to the expected SERVER_DIR. Some
      // installer versions ignore cwd on Windows when resolving paths.
      const args = ['-jar', installerJar, 'server', '-dir', SERVER_DIR, '-mcversion', MC_VERSION, '-loader', fv.loader, '-downloadMinecraft']
      execFile(
        javaPath,
        args,
        { cwd: SERVER_DIR },
        (err, stdout, stderr) => {
          if (err && !fs.existsSync(launchJar)) {
            reject(new Error('Fabric server telepítés hiba: ' + (stderr || err.message)))
          } else {
            resolve()
          }
        }
      )
    })

    if (fs.existsSync(installerJar)) fs.unlinkSync(installerJar)
    state.fabricLoader = fv.loader
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
  } else {
    console.log(`[Installer] Fabric Server (${fv.loader}) már telepítve.`)
  }

  // 3. EULA
  const eulaPath = path.join(SERVER_DIR, 'eula.txt')
  if (!fs.existsSync(eulaPath) || !fs.readFileSync(eulaPath, 'utf8').includes('eula=true')) {
    fs.writeFileSync(eulaPath, 'eula=true\n')
    console.log('[Installer] EULA automatikusan elfogadva.')
  }

  // 3b. server.properties – online-mode=false (offline mód) biztosítása
  const serverPropsPath = path.join(SERVER_DIR, 'server.properties')
  if (!fs.existsSync(serverPropsPath)) {
    // A fájl még nem létezik (első indítás előtt) – létrehozzuk a minimális beállításokkal
    fs.writeFileSync(serverPropsPath, [
      '# Minecraft server properties',
      '# Automatikusan generálva a CobbleServer telepítője által',
      'online-mode=false',
      'server-port=25565',
      'difficulty=normal',
      'gamemode=survival',
      'max-players=20',
      'motd=CobbleVerse Server',
      'spawn-protection=0',
    ].join('\n') + '\n')
    console.log('[Installer] server.properties létrehozva (online-mode=false).')
  } else {
    // A fájl már létezik – meggyőzödünk róla, hogy online-mode=false
    let props = fs.readFileSync(serverPropsPath, 'utf8')
    if (/^online-mode\s*=\s*true/m.test(props)) {
      props = props.replace(/^online-mode\s*=\s*true/m, 'online-mode=false')
      fs.writeFileSync(serverPropsPath, props)
      console.log('[Installer] server.properties: online-mode=true → false (offline mód bekapcsolva).')
    } else if (!/^online-mode\s*=/m.test(props)) {
      // Nincs benne online-mode sor egyáltalán – hozzáadjuk
      fs.writeFileSync(serverPropsPath, props.trimEnd() + '\nonline-mode=false\n')
      console.log('[Installer] server.properties: online-mode=false sor hozzáadva.')
    } else {
      console.log('[Installer] server.properties: online-mode már false, nincs teendő.')
    }
  }

  // 4. Custom assets inject (FancyMenu) for Sync Server
  try {
    const customFancymenuDir = path.join(__dirname, '..', 'build-assets', 'fancymenu')
    const destFancymenuDir = path.join(SERVER_DIR, 'config', 'fancymenu')

    if (fs.existsSync(customFancymenuDir)) {
      console.log('[Installer] Egyedi FancyMenu konfig másolása a szerver adatai közé (szinkronizáláshoz)...')

      const copyRecursive = (src, dest) => {
        fs.mkdirSync(dest, { recursive: true })
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
          const srcPath = path.join(src, entry.name)
          const destPath = path.join(dest, entry.name)
          if (entry.isDirectory()) {
            copyRecursive(srcPath, destPath)
          } else {
            fs.copyFileSync(srcPath, destPath)
          }
        }
      }

      // Régi fájlok teljes törlése másolás előtt
      if (fs.existsSync(destFancymenuDir)) {
        fs.rmSync(destFancymenuDir, { recursive: true, force: true })
        console.log('[Installer] Korábbi FancyMenu konfig teljesen törölve a tiszta cseréhez.')
      }

      copyRecursive(customFancymenuDir, destFancymenuDir)
      console.log('[Installer] FancyMenu konfig sikeresen átmásolva.')
    }
  } catch (err) {
    console.error(`[Installer] Hiba a FancyMenu konfig másolásakor: ${err.message}`)
  }

  // 5. Extra Mods (Chipped, TerraBlender)
  await ensureExtraMods()

  // 6. Blacklist Cleanup (Ensure unwanted mods are gone)
  await cleanupBlacklistedMods()

  // 7. Modrinth Mod Updates
  await updateModsFromModrinth()

  console.log('[Installer] Telepítés sikeres! Minden készen áll.')

  return javaPath
}

module.exports = { install }
