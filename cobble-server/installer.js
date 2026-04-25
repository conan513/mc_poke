const fs = require('fs')
const fse = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
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
  
  if (process.platform !== 'win32') fs.chmodSync(javaExe, 0o755)
  console.log('[Java] Java 21 telepítése sikeres.')
  return javaExe
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

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = (targetUrl) => {
      const mod = targetUrl.startsWith('https') ? https : http
      mod.get(targetUrl, { headers: { 'User-Agent': 'CobbleServer/1.0' } }, res => {
        if ([301, 302].includes(res.statusCode)) return request(res.headers.location)
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch(e) { reject(e) }
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
      if (lowerName.includes('no hunger') || lowerName.includes('mobsbegone') || lowerName.includes('no ender dragon') || lowerName.includes('soundsbegone')) continue
      
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
      if (lowerPath.includes('no hunger') || lowerPath.includes('mobsbegone') || lowerPath.includes('no ender dragon') || lowerPath.includes('soundsbegone')) return false
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
          await downloadFile(downloadUrl, dest).catch(() => {})
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
      execFile(
        javaPath,
        ['-jar', installerJar, 'server', '-mcversion', MC_VERSION, '-loader', fv.loader, '-downloadMinecraft'],
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

  console.log('[Installer] Telepítés sikeres! Minden készen áll.')

  return javaPath
}

module.exports = { install }
