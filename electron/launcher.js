/**
 * CobbleLauncher – Core Launcher Logic
 * Downloads: Java 21, Minecraft 1.21.1 (via MCLC), Fabric Loader, COBBLEVERSE modpack
 * Launches the game with offline authentication
 */

const { Client, Authenticator } = require('minecraft-launcher-core')
const path = require('path')
const fs = require('fs')
const fse = require('fs-extra')
const https = require('https')
const http = require('http')
const { execFile, exec } = require('child_process')
const AdmZip = require('adm-zip')
const os = require('os')
const { app } = require('electron')
const { syncServerMods } = require('./sync')

/**
 * Creates a valid Minecraft servers.dat NBT buffer with a single server entry.
 */
function createServersDatBuffer(name, ip) {
  const writeString = (s) => {
    const b = Buffer.from(s, 'utf8')
    const len = Buffer.alloc(2)
    len.writeUInt16BE(b.length)
    return Buffer.concat([len, b])
  }
  const parts = []
  parts.push(Buffer.from([10, 0, 0])) // Root Compound (unnamed)
  parts.push(Buffer.from([9]))         // Tag List
  parts.push(writeString("servers"))   // List name
  parts.push(Buffer.from([10]))        // List element type: Compound
  const count = Buffer.alloc(4)
  count.writeInt32BE(1)
  parts.push(count)                    // List size: 1
  
  // Server Compound
  parts.push(Buffer.from([8]))         // String
  parts.push(writeString("name"))
  parts.push(writeString(name))
  parts.push(Buffer.from([8]))         // String
  parts.push(writeString("ip"))
  parts.push(writeString(ip))
  parts.push(Buffer.from([1]))         // Byte
  parts.push(writeString("hidden"))
  parts.push(Buffer.from([0]))
  parts.push(Buffer.from([0]))         // End Compound (server)
  
  parts.push(Buffer.from([0]))         // End Compound (root)
  return Buffer.concat(parts)
}

// ── Constants ────────────────────────────────────────────────

const MODPACK_PROJECT_ID = 'Jkb29YJU'
const MC_VERSION = '1.21.1'

// Modrinth API – latest modpack versions for this MC version & Fabric
const MODRINTH_VERSIONS_URL =
  `https://api.modrinth.com/v2/project/${MODPACK_PROJECT_ID}/version` +
  `?loaders=["fabric"]&game_versions=["${MC_VERSION}"]`

// Fabric Meta API – always fetch the latest stable loader for MC_VERSION
const FABRIC_META_URL = `https://meta.fabricmc.net/v2/versions/loader/${MC_VERSION}`
const FABRIC_INSTALLER_META_URL = 'https://meta.fabricmc.net/v2/versions/installer'

// Runtime state – populated after resolving from API
let resolvedFabricLoaderVersion = null
let resolvedFabricInstallerVersion = null

// Java 21 download URLs per platform
const JAVA_URLS = {
  linux_x64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_x64_linux_hotspot_21.0.5_11.tar.gz',
  linux_arm64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_aarch64_linux_hotspot_21.0.5_11.tar.gz',
  win32_x64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_x64_windows_hotspot_21.0.5_11.zip',
  darwin_x64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_x64_mac_hotspot_21.0.5_11.tar.gz',
  darwin_arm64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_aarch64_mac_hotspot_21.0.5_11.tar.gz',
}

// State file helpers
function getStateFile() {
  return path.join(getGameDir(), 'launcher-state.json')
}

function readState() {
  try {
    const f = getStateFile()
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch (_) {}
  return {}
}

function writeState(data) {
  try {
    const current = readState()
    fs.writeFileSync(getStateFile(), JSON.stringify({ ...current, ...data }, null, 2))
  } catch (_) {}
}

let gameDir
let javaPath
let progressCallback = null

function getGameDir() {
  if (gameDir) return gameDir
  const userData = app.getPath('userData')
  gameDir = path.join(userData, 'cobbleverse')
  fse.ensureDirSync(gameDir)
  return gameDir
}

function getJavaDir() {
  return path.join(getGameDir(), 'java21')
}

function getModpackDir() {
  return path.join(getGameDir(), 'cobbleverse-instance')
}

function sendProgress(step, percent, message) {
  if (progressCallback) {
    progressCallback({ step, percent, message })
  }
}

// ── Download helper ──────────────────────────────────────────

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    fse.ensureDirSync(path.dirname(dest))

    const request = (targetUrl) => {
      const mod = targetUrl.startsWith('https') ? https : http
      mod.get(targetUrl, { headers: { 'User-Agent': 'CobbleLauncher/1.0' } }, (res) => {
        // Follow redirects
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          return request(res.headers.location)
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`))
        }
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let downloaded = 0
        const file = fs.createWriteStream(dest)
        res.on('data', (chunk) => {
          downloaded += chunk.length
          if (total > 0 && onProgress) onProgress(downloaded / total)
        })
        res.pipe(file)
        file.on('finish', () => file.close(resolve))
        file.on('error', reject)
        res.on('error', reject)
      }).on('error', reject)
    }
    request(url)
  })
}

// ── Java Installation ────────────────────────────────────────

async function installJava() {
  const javaDir = getJavaDir()
  const javaExe = getJavaExecutable()

  if (fs.existsSync(javaExe)) {
    sendProgress('java', 100, 'Java 21 már telepítve ✓')
    javaPath = javaExe
    return
  }

  const platform = process.platform
  const arch = process.arch
  const key = `${platform}_${arch === 'arm64' ? 'arm64' : 'x64'}`
  const url = JAVA_URLS[key] || JAVA_URLS[`${platform}_x64`]

  if (!url) throw new Error(`Nem támogatott platform: ${platform} ${arch}`)

  sendProgress('java', 0, 'Java 21 letöltése...')
  const ext = url.endsWith('.zip') ? '.zip' : '.tar.gz'
  const javaDl = path.join(getGameDir(), `java21${ext}`)

  await downloadFile(url, javaDl, (p) => {
    sendProgress('java', Math.round(p * 60), `Java 21 letöltése: ${Math.round(p * 100)}%`)
  })

  sendProgress('java', 65, 'Java 21 kicsomagolása...')
  fse.ensureDirSync(javaDir)

  if (ext === '.zip') {
    const zip = new AdmZip(javaDl)
    zip.extractAllTo(javaDir, true)
  } else {
    // tar.gz
    await new Promise((resolve, reject) => {
      exec(`tar -xzf "${javaDl}" -C "${javaDir}" --strip-components=1`, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  fs.unlinkSync(javaDl)
  javaPath = getJavaExecutable()

  // Make executable on unix
  if (process.platform !== 'win32') {
    fs.chmodSync(javaPath, 0o755)
  }

  sendProgress('java', 100, 'Java 21 telepítve ✓')
}

function getJavaExecutable() {
  const javaDir = getJavaDir()
  if (process.platform === 'win32') {
    return path.join(javaDir, 'bin', 'java.exe')
  } else if (process.platform === 'darwin') {
    return path.join(javaDir, 'Contents', 'Home', 'bin', 'java')
  } else {
    return path.join(javaDir, 'bin', 'java')
  }
}

// ── Fabric Installer ─────────────────────────────────────────

/**
 * Fetch the latest stable Fabric Loader + Installer versions from the Fabric Meta API.
 * Returns { loader: '0.x.y', installer: '1.x.y' }
 */
async function fetchLatestFabricVersions() {
  return new Promise((resolve, reject) => {
    const makeReq = (url, cb) => {
      const mod = url.startsWith('https') ? https : http
      mod.get(url, { headers: { 'User-Agent': 'CobbleLauncher/1.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) return makeReq(res.headers.location, cb)
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => { try { cb(null, JSON.parse(data)) } catch(e) { cb(e) } })
        res.on('error', cb)
      }).on('error', cb)
    }

    // Loader list for our MC version – first entry is the latest stable
    makeReq(FABRIC_META_URL, (err, loaderList) => {
      if (err || !Array.isArray(loaderList) || loaderList.length === 0) {
        return reject(new Error('Fabric Meta API elérhetetlen – ellenőrizd az internetkapcsolatot!'))
      }
      // Filter to stable only (stable: true)
      const stable = loaderList.filter(e => e.loader?.stable !== false)
      const latestLoader = (stable[0] || loaderList[0]).loader.version

      // Installer list
      makeReq(FABRIC_INSTALLER_META_URL, (err2, installerList) => {
        if (err2 || !Array.isArray(installerList) || installerList.length === 0) {
          return reject(new Error('Fabric Installer API elérhetetlen!'))
        }
        const stableInst = installerList.filter(e => e.stable !== false)
        const latestInstaller = (stableInst[0] || installerList[0]).version
        resolve({ loader: latestLoader, installer: latestInstaller })
      })
    })
  })
}

async function installFabric() {
  const mcDir = path.join(getGameDir(), 'minecraft')

  // ── 1. Resolve latest versions from Fabric API ──────────────
  sendProgress('fabric', 2, 'Fabric verzió ellenőrzése...')
  let latestLoader, latestInstaller
  try {
    const v = await fetchLatestFabricVersions()
    latestLoader = v.loader
    latestInstaller = v.installer
    resolvedFabricLoaderVersion = latestLoader
    resolvedFabricInstallerVersion = latestInstaller
    console.log(`[Fabric] Legfrissebb loader: ${latestLoader}, installer: ${latestInstaller}`)
  } catch (e) {
    // Fallback: use last known version from state file
    const state = readState()
    if (state.fabricLoaderVersion) {
      console.warn('[Fabric] API nem elérhető, tárolt verzió használata:', state.fabricLoaderVersion)
      latestLoader = state.fabricLoaderVersion
      latestInstaller = state.fabricInstallerVersion || '1.0.1'
      resolvedFabricLoaderVersion = latestLoader
    } else {
      throw e
    }
  }

  // ── 2. Compare with installed version ───────────────────────
  const state = readState()
  const installedLoader = state.fabricLoaderVersion
  const versionId = `fabric-loader-${latestLoader}-${MC_VERSION}`
  const versionJson = path.join(mcDir, 'versions', versionId, `${versionId}.json`)

  const alreadyInstalled = fs.existsSync(versionJson)
  const isUpToDate = alreadyInstalled && installedLoader === latestLoader

  if (isUpToDate) {
    sendProgress('fabric', 100, `Fabric Loader ${latestLoader} már telepítve ✓`)
    return
  }

  if (alreadyInstalled && installedLoader && installedLoader !== latestLoader) {
    sendProgress('fabric', 5, `Fabric frissítés: ${installedLoader} → ${latestLoader}`)
  } else {
    sendProgress('fabric', 5, `Fabric Loader ${latestLoader} telepítése...`)
  }

  // ── 3. Download Fabric Installer ────────────────────────────
  const installerUrl = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${latestInstaller}/fabric-installer-${latestInstaller}.jar`
  const installerJar = path.join(getGameDir(), 'fabric-installer.jar')

  sendProgress('fabric', 8, `Fabric Installer ${latestInstaller} letöltése...`)
  await downloadFile(installerUrl, installerJar, (p) => {
    sendProgress('fabric', 8 + Math.round(p * 32), `Fabric Installer: ${Math.round(p * 100)}%`)
  })

  // ── 4. Run Fabric Installer ──────────────────────────────────
  sendProgress('fabric', 42, `Fabric Loader ${latestLoader} telepítése...`)
  fse.ensureDirSync(mcDir)

  await new Promise((resolve, reject) => {
    const java = javaPath || 'java'
    exec(
      `"${java}" -jar "${installerJar}" client -dir "${mcDir}" -mcversion ${MC_VERSION} -loader ${latestLoader} -noprofile`,
      (err, stdout, stderr) => {
        if (err) {
          console.error('Fabric stderr:', stderr)
          if (fs.existsSync(versionJson)) {
            resolve()
          } else {
            reject(new Error('Fabric telepítés sikertelen: ' + (stderr || err.message)))
          }
        } else {
          resolve()
        }
      }
    )
  })

  if (fs.existsSync(installerJar)) fs.unlinkSync(installerJar)

  // ── 5. Persist installed version ────────────────────────────
  writeState({
    fabricLoaderVersion: latestLoader,
    fabricInstallerVersion: latestInstaller,
    fabricInstalledAt: new Date().toISOString(),
  })

  sendProgress('fabric', 100, `Fabric Loader ${latestLoader} telepítve ✓`)
}

// ── Minecraft Assets + Libraries ─────────────────────────────

async function installMinecraft() {
  sendProgress('minecraft', 0, 'Minecraft 1.21.1 letöltése...')

  const mcDir = path.join(getGameDir(), 'minecraft')
  const client = new Client()

  // We use MCLC to download assets & libs by launching with skip
  // But first let's just check if the client jar exists
  const clientJar = path.join(mcDir, 'versions', MC_VERSION, `${MC_VERSION}.jar`)
  if (fs.existsSync(clientJar)) {
    sendProgress('minecraft', 100, 'Minecraft már telepítve ✓')
    return
  }

  // Download version manifest
  sendProgress('minecraft', 5, 'Verzió adatok letöltése...')
  const manifestUrl = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
  const manifestPath = path.join(getGameDir(), 'version_manifest.json')
  await downloadFile(manifestUrl, manifestPath)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const versionEntry = manifest.versions.find(v => v.id === MC_VERSION)
  if (!versionEntry) throw new Error(`Minecraft verzió nem található: ${MC_VERSION}`)

  // Download version JSON
  sendProgress('minecraft', 10, 'Minecraft meta letöltése...')
  const versionDir = path.join(mcDir, 'versions', MC_VERSION)
  fse.ensureDirSync(versionDir)
  const versionJsonPath = path.join(versionDir, `${MC_VERSION}.json`)
  await downloadFile(versionEntry.url, versionJsonPath)
  const versionData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'))

  // Download client jar
  sendProgress('minecraft', 15, 'Minecraft client letöltése...')
  const clientUrl = versionData.downloads.client.url
  await downloadFile(clientUrl, clientJar, (p) => {
    sendProgress('minecraft', 15 + Math.round(p * 25), `Minecraft client: ${Math.round(p * 100)}%`)
  })

  // Download assets index
  sendProgress('minecraft', 42, 'Asset index letöltése...')
  const assetsDir = path.join(mcDir, 'assets')
  const indexDir = path.join(assetsDir, 'indexes')
  fse.ensureDirSync(indexDir)
  const assetIndex = versionData.assetIndex
  const indexPath = path.join(indexDir, `${assetIndex.id}.json`)
  await downloadFile(assetIndex.url, indexPath)
  const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'))

  // Download assets
  const objects = Object.values(indexData.objects)
  const objectsDir = path.join(assetsDir, 'objects')
  fse.ensureDirSync(objectsDir)
  let downloaded = 0
  const total = objects.length
  const batchSize = 20

  sendProgress('minecraft', 45, `Assets letöltése (${total} fájl)...`)

  for (let i = 0; i < objects.length; i += batchSize) {
    const batch = objects.slice(i, i + batchSize)
    await Promise.all(batch.map(async (obj) => {
      const hash = obj.hash
      const subdir = hash.substring(0, 2)
      const destDir = path.join(objectsDir, subdir)
      const destFile = path.join(destDir, hash)
      if (!fs.existsSync(destFile)) {
        fse.ensureDirSync(destDir)
        const assetUrl = `https://resources.download.minecraft.net/${subdir}/${hash}`
        await downloadFile(assetUrl, destFile).catch(() => {}) // skip on error
      }
      downloaded++
    }))
    const pct = 45 + Math.round((downloaded / total) * 25)
    sendProgress('minecraft', pct, `Assets: ${downloaded}/${total}`)
  }

  // Download libraries
  sendProgress('minecraft', 72, 'Könyvtárak letöltése...')
  const libDir = path.join(mcDir, 'libraries')
  const libs = versionData.libraries || []
  let libDone = 0

  for (const lib of libs) {
    if (!lib.downloads?.artifact) { libDone++; continue }
    const artifact = lib.downloads.artifact
    const libPath = path.join(libDir, artifact.path)
    if (!fs.existsSync(libPath)) {
      fse.ensureDirSync(path.dirname(libPath))
      await downloadFile(artifact.url, libPath).catch(() => {})
    }
    libDone++
    if (libDone % 10 === 0) {
      const pct = 72 + Math.round((libDone / libs.length) * 20)
      sendProgress('minecraft', pct, `Könyvtárak: ${libDone}/${libs.length}`)
    }
  }

  sendProgress('minecraft', 100, 'Minecraft 1.21.1 telepítve ✓')
}

// ── Modpack Version Check ─────────────────────────────────────

/**
 * Queries the Modrinth API and returns the latest release version for our
 * MC version + Fabric loader combination.
 * Returns { id, versionNumber, name, downloadUrl, filename, size }
 */
async function fetchLatestModpackVersion() {
  return new Promise((resolve, reject) => {
    const makeReq = (url, cb) => {
      const mod = url.startsWith('https') ? https : http
      mod.get(url, { headers: { 'User-Agent': 'CobbleLauncher/1.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) return makeReq(res.headers.location, cb)
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => { try { cb(null, JSON.parse(data)) } catch (e) { cb(e) } })
        res.on('error', cb)
      }).on('error', cb)
    }

    makeReq(MODRINTH_VERSIONS_URL, (err, versions) => {
      if (err || !Array.isArray(versions) || versions.length === 0) {
        return reject(new Error('Modrinth API nem elérhető – ellenőrizd az internetkapcsolatot!'))
      }
      // Only stable releases, newest first (API already sorts this way)
      const releases = versions.filter(v => v.version_type === 'release')
      const latest = releases[0] || versions[0]
      const primaryFile = latest.files.find(f => f.primary) || latest.files[0]
      resolve({
        id: latest.id,
        versionNumber: latest.version_number,
        name: latest.name,
        downloadUrl: primaryFile.url,
        filename: primaryFile.filename,
        size: primaryFile.size,
      })
    })
  })
}

// ── Modpack Installation ─────────────────────────────────────

async function installModpack() {
  const instanceDir = getModpackDir()
  const modsDir = path.join(instanceDir, 'mods')

  // ── 1. Fetch latest version from Modrinth ────────────────────
  sendProgress('modpack', 2, 'Modpack verzió ellenőrzése...')
  let latest
  try {
    latest = await fetchLatestModpackVersion()
    console.log(`[Modpack] Legfrissebb verzió: ${latest.name} (${latest.id})`)
  } catch (e) {
    // Offline fallback: use stored info
    const state = readState()
    if (state.modpackVersionId) {
      console.warn('[Modpack] API nem elérhető, tárolt verzió használata:', state.modpackVersionId)
      sendProgress('modpack', 100, `COBBLEVERSE ${state.modpackVersionNumber || ''} már telepítve ✓`)
      return
    }
    throw e
  }

  // ── 2. Compare with installed version ────────────────────────
  const state = readState()
  const installedId = state.modpackVersionId
  const isUpToDate = installedId === latest.id && fs.existsSync(path.join(instanceDir, 'mods'))

  if (isUpToDate) {
    sendProgress('modpack', 100, `COBBLEVERSE ${latest.versionNumber} már naprakész ✓`)
    return
  }

  if (installedId && installedId !== latest.id) {
    sendProgress('modpack', 5, `Modpack frissítés: ${state.modpackVersionNumber} → ${latest.versionNumber}`)
    // Clean old mods so stale files don't linger
    if (fs.existsSync(modsDir)) {
      fse.emptyDirSync(modsDir)
      console.log('[Modpack] Régi modok törölve a frissítés előtt.')
    }
  } else {
    sendProgress('modpack', 5, `COBBLEVERSE ${latest.versionNumber} telepítése...`)
  }

  fse.ensureDirSync(instanceDir)
  fse.ensureDirSync(modsDir)

  // ── 3. Download .mrpack ───────────────────────────────────────
  const sizeMB = Math.round((latest.size || 0) / 1024 / 1024)
  sendProgress('modpack', 6, `COBBLEVERSE ${latest.versionNumber} letöltése (${sizeMB} MB)...`)
  const mrpackPath = path.join(getGameDir(), latest.filename)

  await downloadFile(latest.downloadUrl, mrpackPath, (p) => {
    sendProgress('modpack', 6 + Math.round(p * 44), `Modpack letöltése: ${Math.round(p * 100)}%`)
  })

  sendProgress('modpack', 52, 'Modpack kicsomagolása...')

  // ── 4. Extract mrpack (zip) ───────────────────────────────────
  const zip = new AdmZip(mrpackPath)
  const modrinthIndex = JSON.parse(zip.readAsText('modrinth.index.json'))

  // Extract overrides (config, resourcepacks, datapacks…)
  const entries = zip.getEntries()
  for (const entry of entries) {
    const isOverride = entry.entryName.startsWith('overrides/') || entry.entryName.startsWith('client-overrides/')
    if (!isOverride) continue
    const prefix = entry.entryName.startsWith('client-overrides/') ? 'client-overrides/' : 'overrides/'
    const relPath = entry.entryName.slice(prefix.length)
    if (!relPath || entry.isDirectory) continue
    const destPath = path.join(instanceDir, relPath)
    fse.ensureDirSync(path.dirname(destPath))
    fs.writeFileSync(destPath, entry.getData())
  }

  // ── 5. Download mods listed in modrinth.index.json ───────────
  const files = modrinthIndex.files || []
  sendProgress('modpack', 58, `Modok letöltése (${files.length} fájl)...`)
  let done = 0

  for (let i = 0; i < files.length; i += 5) {
    const batch = files.slice(i, i + 5)
    await Promise.all(batch.map(async (file) => {
      const dest = path.join(instanceDir, file.path)
      if (!fs.existsSync(dest)) {
        fse.ensureDirSync(path.dirname(dest))
        const downloadUrl = file.downloads?.[0]
        if (downloadUrl) {
          await downloadFile(downloadUrl, dest).catch((e) => {
            console.warn('Mod letöltési hiba (kihagyva):', file.path, e.message)
          })
        }
      }
      done++
    }))
    const pct = 58 + Math.round((done / files.length) * 38)
    sendProgress('modpack', pct, `Modok: ${done}/${files.length}`)
  }

  // ── 6. Clean up & persist ─────────────────────────────────────
  if (fs.existsSync(mrpackPath)) fs.unlinkSync(mrpackPath)

  writeState({
    modpackVersionId: latest.id,
    modpackVersionNumber: latest.versionNumber,
    modpackName: latest.name,
    modpackInstalledAt: new Date().toISOString(),
  })

  sendProgress('modpack', 100, `COBBLEVERSE ${latest.versionNumber} telepítve ✓`)

  // ── 7. Custom Asset Injection ─────────────────────────────────
  try {
    const serverName = '[SPP]Cobbleverse'
    const serverIp   = '94.72.100.43'
    const serversBuf = createServersDatBuffer(serverName, serverIp)
    
    const defaultOptionsPath = path.join(instanceDir, 'config', 'defaultoptions', 'servers.dat')
    const rootServersPath    = path.join(instanceDir, 'servers.dat')
    
    fse.ensureDirSync(path.dirname(defaultOptionsPath))
    fs.writeFileSync(defaultOptionsPath, serversBuf)
    fs.writeFileSync(rootServersPath, serversBuf)
    
    console.log('[Launcher] Egyedi szerverlista sikeresen injektálva.')
  } catch (e) {
    console.error('[Launcher] Hiba az egyedi szerverlista injektálásakor:', e.message)
  }
}

// ── Public API ───────────────────────────────────────────────

async function install({ username, ram }, onProgress) {
  progressCallback = onProgress

  sendProgress('start', 0, 'Telepítés megkezdése...')

  await installJava()
  await installMinecraft()
  await installFabric()
  await installModpack()

  sendProgress('done', 100, 'Minden telepítve! Jó játékot! 🎮')
  progressCallback = null
}

async function launch({ username, ram, serverUrl }, onLog, onClose) {
  const mcDir = path.join(getGameDir(), 'minecraft')
  const instanceDir = getModpackDir()
  const java = javaPath || getJavaExecutable()

  // Use the resolved (latest) loader version, or fall back to state file
  const state = readState()
  const loaderVersion = resolvedFabricLoaderVersion || state.fabricLoaderVersion || '0.16.9'
  const versionId = `fabric-loader-${loaderVersion}-${MC_VERSION}`

  onLog?.(`[Launcher] Fabric Loader: ${loaderVersion}`)

  // ── Sync Custom Server Mods ──────────────────────────────────
  if (serverUrl && serverUrl.trim() !== '') {
    try {
      const modsDir = path.join(instanceDir, 'mods')
      await syncServerMods(serverUrl.trim(), modsDir, onLog)
    } catch (e) {
      onLog?.(`[Sync-Hiba] Kivétel a szinkronizáció során: ${e.message}`)
    }
  }

  const client = new Client()

  const opts = {
    authorization: Authenticator.getAuth(username),
    root: mcDir,
    version: {
      number: MC_VERSION,
      type: 'release',
      custom: versionId,
    },
    memory: {
      max: `${ram || 4096}M`,
      min: '2048M',
    },
    javaPath: java,
    gameDirectory: instanceDir,
    overrides: {
      gameDirectory: instanceDir,
    },
  }

  client.on('arguments', (args) => {
    onLog?.(`[ARGS] ${args.join(' ')}`)
  })
  client.on('data', (data) => {
    onLog?.(data.toString())
  })
  client.on('close', (code) => {
    onLog?.(`Játék bezárva (exit: ${code})`)
    onClose?.()
  })

  client.launch(opts)
}

function isInstalled() {
  const state = readState()
  const modsDir = path.join(getModpackDir(), 'mods')
  const clientJar = path.join(getGameDir(), 'minecraft', 'versions', MC_VERSION, `${MC_VERSION}.jar`)
  const javaExe = getJavaExecutable()
  const modpackOk = !!state.modpackVersionId && fs.existsSync(modsDir)
  return {
    java: fs.existsSync(javaExe),
    minecraft: fs.existsSync(clientJar),
    modpack: modpackOk,
    modpackVersion: state.modpackVersionNumber || null,
    fabricVersion: state.fabricLoaderVersion || null,
    allDone: fs.existsSync(javaExe) && fs.existsSync(clientJar) && modpackOk,
  }
}

/**
 * Lightweight update check – does NOT install, just returns available update info.
 * Called from the renderer (home screen) in the background.
 */
async function checkForUpdates() {
  const state = readState()
  const result = { modpack: null, fabric: null }

  // Modpack
  try {
    const latest = await fetchLatestModpackVersion()
    if (latest.id !== state.modpackVersionId) {
      result.modpack = {
        currentVersion: state.modpackVersionNumber || '?',
        latestVersion: latest.versionNumber,
        latestId: latest.id,
        latestName: latest.name,
      }
    }
  } catch (_) {}

  // Fabric
  try {
    const v = await fetchLatestFabricVersions()
    if (v.loader !== state.fabricLoaderVersion) {
      result.fabric = {
        currentVersion: state.fabricLoaderVersion || '?',
        latestVersion: v.loader,
      }
    }
  } catch (_) {}

  return result
}

module.exports = { install, launch, isInstalled, checkForUpdates }
