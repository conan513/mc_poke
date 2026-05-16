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
const crypto = require('crypto')
const { app } = require('electron')
const { syncServerMods } = require('./sync')


// ── Constants ────────────────────────────────────────────────

const MODPACK_PROJECT_ID = 'Jkb29YJU'
const MC_VERSION = '1.21.1'
const JAVA_VERSION_TARGET = 21


// Modrinth API – latest modpack versions for this MC version & Fabric
const MODRINTH_VERSIONS_URL =
  `https://api.modrinth.com/v2/project/${MODPACK_PROJECT_ID}/version` +
  `?loaders=["fabric"]&game_versions=["${MC_VERSION}"]`

// Fabric Meta API – always fetch the latest stable loader for MC_VERSION
const FABRIC_META_URL = `https://meta.fabricmc.net/v2/versions/loader/${MC_VERSION}`
const FABRIC_INSTALLER_META_URL = 'https://meta.fabricmc.net/v2/versions/installer'

// Runtime state – populated after resolving from API
let resolvedNeoForgeVersion = null
let resolvedFabricLoaderVersion = null
let resolvedFabricInstallerVersion = null

// Java 21 download URLs per platform
const JAVA_URLS = {
  linux_x64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.6%2B7/OpenJDK21U-jdk_x64_linux_hotspot_21.0.6_7.tar.gz',
  linux_arm64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.6%2B7/OpenJDK21U-jdk_aarch64_linux_hotspot_21.0.6_7.tar.gz',
  win32_x64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.6%2B7/OpenJDK21U-jdk_x64_windows_hotspot_21.0.6_7.zip',
  win32_arm64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.6%2B7/OpenJDK21U-jdk_aarch64_windows_hotspot_21.0.6_7.zip',
  darwin_x64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.6%2B7/OpenJDK21U-jdk_x64_mac_hotspot_21.0.6_7.tar.gz',
  darwin_arm64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.6%2B7/OpenJDK21U-jdk_aarch64_mac_hotspot_21.0.6_7.tar.gz',
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

/**
 * NEW DIRECTORY STRUCTURE (Prism Launcher style)
 * ROOT (userData)
 *   ├── assets/
 *   ├── libraries/
 *   ├── versions/
 *   ├── java21/
 *   └── instances/
 *       └── cobbleverse/
 *           └── minecraft/ (gameDirectory: mods, config, etc.)
 */

function getRootDataDir() {
  return app.getPath('userData')
}

function getInstanceDir() {
  return path.join(getRootDataDir(), 'instances', 'cobbleverse')
}

function getMinecraftDir() {
  const dir = path.join(getInstanceDir(), 'minecraft')
  fse.ensureDirSync(dir)
  return dir
}

function getGameDir() {
  // For MCLC 'root' (assets, libraries, versions)
  return getRootDataDir()
}

function getJavaDir() {
  return path.join(getRootDataDir(), 'java21')
}

function getModpackDir() {
  // For mods, config, etc.
  return getMinecraftDir()
}

/**
 * Migrates old folder structure to new Prism-style structure if needed.
 */
function migrateStructure() {
  const userData = getRootDataDir()
  const oldBase = path.join(userData, 'cobbleverse')
  const newInstance = getMinecraftDir()

  if (fs.existsSync(oldBase) && !oldBase.includes('instances')) {
    console.log('[Migration] Régi mappaszerkezet észlelt, költöztetés...')
    try {
      // 1. Move assets, libraries, versions from oldBase/minecraft to ROOT
      const oldMc = path.join(oldBase, 'minecraft')
      if (fs.existsSync(oldMc)) {
        const entries = fs.readdirSync(oldMc)
        for (const entry of entries) {
          const src = path.join(oldMc, entry)
          const dst = path.join(userData, entry)
          if (!fs.existsSync(dst)) {
            fse.moveSync(src, dst, { overwrite: false })
          }
        }
        fse.removeSync(oldMc)
      }

      // 2. Move everything else from oldBase to newInstance
      const entries = fs.readdirSync(oldBase)
      for (const entry of entries) {
        const src = path.join(oldBase, entry)
        if (entry === 'java21') {
          const dst = path.join(userData, 'java21')
          if (!fs.existsSync(dst)) fse.moveSync(src, dst)
          else fse.removeSync(src)
        } else if (entry === 'launcher-state.json') {
          const dst = path.join(userData, 'launcher-state.json')
          if (!fs.existsSync(dst)) fse.moveSync(src, dst)
          else fse.removeSync(src)
        } else {
          // Everything else (mods, config, saves, etc.) goes to newInstance
          const dst = path.join(newInstance, entry)
          fse.moveSync(src, dst, { overwrite: true })
        }
      }
      fse.removeSync(oldBase)
      console.log('[Migration] Költöztetés sikeres.')
    } catch (e) {
      console.error('[Migration-Hiba] Hiba a költöztetés során:', e.message)
    }
  }
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
        'User-Agent': 'CobbleLauncher/1.0',
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

// ── Java Installation ────────────────────────────────────────

async function installJava() {
  const javaDir = getJavaDir()
  const javaExe = getJavaExecutable()

  const state = readState()
  const installedJavaVer = state.javaVersion

  if (fs.existsSync(javaExe) && installedJavaVer === JAVA_VERSION_TARGET) {
    sendProgress('java', 100, `Java ${JAVA_VERSION_TARGET} már telepítve ✓`)
    javaPath = javaExe
    return
  }

  // If we have a mismatching Java version, clear the directory
  if (fs.existsSync(javaDir)) {
    console.log(`[Java] Verzió váltás észlelve (${installedJavaVer} -> ${JAVA_VERSION_TARGET}). Régi Java törlése...`)
    fse.removeSync(javaDir)
  }

  const platform = process.platform
  const arch = process.arch
  const key = `${platform}_${arch === 'arm64' ? 'arm64' : 'x64'}`
  const url = JAVA_URLS[key] || JAVA_URLS[`${platform}_x64`]

  if (!url) throw new Error(`Nem támogatott platform: ${platform} ${arch}`)

  sendProgress('java', 0, `Java ${JAVA_VERSION_TARGET} letöltése...`)
  const ext = url.endsWith('.zip') ? '.zip' : '.tar.gz'
  const javaDl = path.join(getGameDir(), `java_download${ext}`)

  await downloadFile(url, javaDl, (p) => {
    sendProgress('java', Math.round(p * 60), `Java ${JAVA_VERSION_TARGET} letöltése: ${Math.round(p * 100)}%`)
  })

  sendProgress('java', 65, `Java ${JAVA_VERSION_TARGET} kicsomagolása...`)
  fse.ensureDirSync(javaDir)


  if (ext === '.zip') {
    const zip = new AdmZip(javaDl)
    zip.extractAllTo(javaDir, true)
  } else {
    // tar.gz
    await new Promise(async (resolve, reject) => {
      execFile('tar', ['-xzf', javaDl, '-C', javaDir, '--strip-components=1'], (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  fs.unlinkSync(javaDl)
  // After extraction, try to robustly find the java executable (handle
  // archives that extract into a top-level directory like jdk-21.../)
  function findJavaExecutableFromDir(dir) {
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

    try {
      const entries = fs.readdirSync(dir)
      for (const e of entries) {
        const candidateDir = path.join(dir, e)
        const alt = process.platform === 'win32'
          ? path.join(candidateDir, 'bin', 'java.exe')
          : path.join(candidateDir, 'bin', 'java')
        if (fs.existsSync(alt)) return alt
        if (process.platform === 'darwin') {
          const alt2 = path.join(candidateDir, 'Contents', 'Home', 'bin', 'java')
          if (fs.existsSync(alt2)) return alt2
        }
      }
    } catch (e) {}

    return candidates[0]
  }

  javaPath = findJavaExecutableFromDir(getJavaDir())

  // Make executable on unix
  if (process.platform !== 'win32' && fs.existsSync(javaPath)) {
    fs.chmodSync(javaPath, 0o755)
  }

  sendProgress('java', 100, `Java ${JAVA_VERSION_TARGET} telepítve ✓`)
  
  // Persist installed version
  writeState({
    javaVersion: JAVA_VERSION_TARGET
  })
}


function getJavaExecutable() {
  const javaDir = getJavaDir()
  if (!fs.existsSync(javaDir)) {
    if (process.platform === 'win32') return path.join(javaDir, 'bin', 'java.exe')
    if (process.platform === 'darwin') return path.join(javaDir, 'Contents', 'Home', 'bin', 'java')
    return path.join(javaDir, 'bin', 'java')
  }

  if (process.platform === 'win32') {
    const binJava = path.join(javaDir, 'bin', 'java.exe')
    if (fs.existsSync(binJava)) return binJava
    
    try {
      const entries = fs.readdirSync(javaDir)
      for (const entry of entries) {
        const fullPath = path.join(javaDir, entry, 'bin', 'java.exe')
        if (fs.existsSync(fullPath)) return fullPath
      }
    } catch (e) {
      console.warn('[Java] Hiba a könyvtár olvasásakor:', e.message)
    }
    return binJava
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
  const mcDir = getGameDir()

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

  await new Promise(async (resolve, reject) => {
    const java = javaPath || getJavaExecutable() || 'java'

    const pemPath = process.env.COBBLE_CA_PEM || path.join(getGameDir(), 'custom_ca.pem')
    let truststorePath = null
    const truststorePass = 'changeit'
    if (fs.existsSync(pemPath)) {
      try {
        const getKeytoolPath = (javaExe) => {
          const binDir = path.dirname(javaExe)
          const kt = process.platform === 'win32' ? path.join(binDir, 'keytool.exe') : path.join(binDir, 'keytool')
          return kt
        }

        const keytool = getKeytoolPath(java)
        truststorePath = path.join(getGameDir(), 'custom-truststore.p12')

        if (fs.existsSync(keytool)) {
          await new Promise(async (kresolve, kreject) => {
            const ktArgs = ['-importcert', '-file', pemPath, '-alias', 'cobble_ca', '-keystore', truststorePath, '-storepass', truststorePass, '-storetype', 'PKCS12', '-noprompt']
            execFile(keytool, ktArgs, { cwd: getGameDir() }, (kerr, kstdout, kstderr) => {
              if (kerr) {
                console.error('[Truststore] keytool failed:', kstderr || kerr.message)
                truststorePath = null
                return kresolve()
              }
              console.log('[Truststore] custom truststore created at', truststorePath)
              return kresolve()
            })
          })
        } else {
          console.warn('[Truststore] keytool nem található a java mellett.')
          truststorePath = null
        }
      } catch (e) {
        console.warn('[Truststore] Hiba a truststore létrehozásakor:', e.message)
        truststorePath = null
      }
    }

    const jvmOptions = []
    if (truststorePath) {
      jvmOptions.push(`-Djavax.net.ssl.trustStore=${truststorePath}`)
      jvmOptions.push(`-Djavax.net.ssl.trustStorePassword=${truststorePass}`)
    }

    if (process.platform === 'win32') {
      jvmOptions.push('-Djavax.net.ssl.trustStoreType=WINDOWS-ROOT')
    }

    const args = [...jvmOptions, '-jar', installerJar, 'client', '-dir', mcDir, '-mcversion', MC_VERSION, '-loader', latestLoader, '-noprofile']

    execFile(java, args, { cwd: mcDir, windowsHide: true }, (err, stdout, stderr) => {
      if (stdout && stdout.trim()) console.log('[Fabric installer stdout]\n' + stdout)
      if (stderr && stderr.trim()) console.error('[Fabric installer stderr]\n' + stderr)
      if (err) {
        if (fs.existsSync(versionJson)) {
          return resolve()
        }
        return reject(new Error('Fabric telepítés sikertelen: ' + (stderr || err.message)))
      }
      return resolve()
    })
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

// ── NeoForge Installer ─────────────────────────────────────────

/**
 * Fetch the latest NeoForge version for MC_VERSION (e.g., 21.1.x)
 * Parses the maven-metadata.xml from NeoForge maven repository.
 */
async function fetchLatestNeoForgeVersion() {
  return new Promise((resolve, reject) => {
    const url = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml'
    const makeReq = (url, cb) => {
      const mod = url.startsWith('https') ? https : http
      mod.get(url, { headers: { 'User-Agent': 'CobbleLauncher/1.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) return makeReq(res.headers.location, cb)
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => { cb(null, data) })
        res.on('error', cb)
      }).on('error', cb)
    }

    makeReq(url, (err, xml) => {
      if (err || !xml) {
        return reject(new Error('NeoForge Maven API elérhetetlen – ellenőrizd az internetkapcsolatot!'))
      }
      
      // Parse all <version> tags
      const versions = []
      const regex = /<version>([^<]+)<\/version>/g
      let match
      while ((match = regex.exec(xml)) !== null) {
        versions.push(match[1])
      }

      // Filter to our major.minor version, e.g. 21.1.*
      // MC 1.21.1 corresponds to NeoForge 21.1.x
      const prefix = MC_VERSION.substring(2) + '.' // "21.1."
      const compatibleVersions = versions.filter(v => v.startsWith(prefix))
      
      if (compatibleVersions.length === 0) {
        return reject(new Error(`Nem találtunk NeoForge verziót a ${MC_VERSION} verzióhoz!`))
      }

      // Sort versions based on build number (the third part)
      compatibleVersions.sort((a, b) => {
        const aBuild = parseInt(a.split('.')[2] || 0)
        const bBuild = parseInt(b.split('.')[2] || 0)
        return bBuild - aBuild // Descending order
      })

      resolve(compatibleVersions[0])
    })
  })
}

async function installNeoForge() {
  const mcDir = getGameDir()

  // ── 1. Resolve latest versions from NeoForge Maven ──────────────
  sendProgress('neoforge', 2, 'NeoForge verzió ellenőrzése...')
  let latestLoader
  try {
    latestLoader = await fetchLatestNeoForgeVersion()
    resolvedNeoForgeVersion = latestLoader
    console.log(`[NeoForge] Legfrissebb loader: ${latestLoader}`)
  } catch (e) {
    // Fallback: use last known version from state file
    const state = readState()
    if (state.neoForgeVersion) {
      console.warn('[NeoForge] API nem elérhető, tárolt verzió használata:', state.neoForgeVersion)
      latestLoader = state.neoForgeVersion
      resolvedNeoForgeVersion = latestLoader
    } else {
      throw e
    }
  }

  // ── 2. Compare with installed version ───────────────────────
  const state = readState()
  const installedLoader = state.neoForgeVersion
  const versionId = `neoforge-${latestLoader}`
  const versionJson = path.join(mcDir, 'versions', versionId, `${versionId}.json`)

  const alreadyInstalled = fs.existsSync(versionJson)
  const isUpToDate = alreadyInstalled && installedLoader === latestLoader

  if (isUpToDate) {
    sendProgress('neoforge', 100, `NeoForge ${latestLoader} már telepítve ✓`)
    return
  }

  if (alreadyInstalled && installedLoader && installedLoader !== latestLoader) {
    sendProgress('neoforge', 5, `NeoForge frissítés: ${installedLoader} → ${latestLoader}`)
  } else {
    sendProgress('neoforge', 5, `NeoForge ${latestLoader} telepítése...`)
  }

  // ── 3. Download NeoForge Installer ────────────────────────────
  const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${latestLoader}/neoforge-${latestLoader}-installer.jar`
  const installerJar = path.join(getGameDir(), 'neoforge-installer.jar')

  sendProgress('neoforge', 8, `NeoForge Installer letöltése...`)
  await downloadFile(installerUrl, installerJar, (p) => {
    sendProgress('neoforge', 8 + Math.round(p * 32), `NeoForge Installer: ${Math.round(p * 100)}%`)
  })

  // ── 4. Run NeoForge Installer ──────────────────────────────────
  sendProgress('neoforge', 42, `NeoForge ${latestLoader} telepítése...`)
  fse.ensureDirSync(mcDir)

  await new Promise(async (resolve, reject) => {
    const java = javaPath || getJavaExecutable() || 'java'

    // If a custom CA PEM was provided, import it into a PKCS12 truststore
    const pemPath = process.env.COBBLE_CA_PEM || path.join(getGameDir(), 'custom_ca.pem')
    let truststorePath = null
    const truststorePass = 'changeit'
    if (fs.existsSync(pemPath)) {
      try {
        const getKeytoolPath = (javaExe) => {
          const binDir = path.dirname(javaExe)
          const kt = process.platform === 'win32' ? path.join(binDir, 'keytool.exe') : path.join(binDir, 'keytool')
          return kt
        }

        const keytool = getKeytoolPath(java)
        truststorePath = path.join(getGameDir(), 'custom-truststore.p12')

        if (fs.existsSync(keytool)) {
          await new Promise(async (kresolve, kreject) => {
            const ktArgs = ['-importcert', '-file', pemPath, '-alias', 'cobble_ca', '-keystore', truststorePath, '-storepass', truststorePass, '-storetype', 'PKCS12', '-noprompt']
            execFile(keytool, ktArgs, { cwd: getGameDir() }, (kerr, kstdout, kstderr) => {
              if (kerr) {
                console.error('[Truststore] keytool failed:', kstderr || kerr.message)
                truststorePath = null
                return kresolve()
              }
              console.log('[Truststore] custom truststore created at', truststorePath)
              return kresolve()
            })
          })
        } else {
          console.warn('[Truststore] keytool nem található a java mellett.')
          truststorePath = null
        }
      } catch (e) {
        console.warn('[Truststore] Hiba a truststore létrehozásakor:', e.message)
        truststorePath = null
      }
    }

    const jvmOptions = [
      // The NeoForge installer is a Swing/AWT GUI app – without this flag it
      // tries to open a window, which fails in Electron's headless main process.
      '-Djava.awt.headless=true',
    ]
    if (truststorePath) {
      jvmOptions.push(`-Djavax.net.ssl.trustStore=${truststorePath}`)
      jvmOptions.push(`-Djavax.net.ssl.trustStorePassword=${truststorePass}`)
    }

    if (process.platform === 'win32') {
      jvmOptions.push('-Djavax.net.ssl.trustStoreType=WINDOWS-ROOT')
    }

    // The NeoForge installer validates that launcher_profiles.json exists in the
    // target directory before it proceeds. Create a minimal dummy if absent.
    const profilesJson = path.join(mcDir, 'launcher_profiles.json')
    if (!fs.existsSync(profilesJson)) {
      fs.writeFileSync(profilesJson, JSON.stringify({
        profiles: {},
        selectedProfile: '(Default)',
        clientToken: crypto.randomUUID?.() || 'cobble-launcher',
        authenticationDatabase: {},
        launcherVersion: { name: '2.13.1', format: 21 }
      }, null, 2))
      console.log('[NeoForge] launcher_profiles.json létrehozva (dummy).')
    }

    // NeoForge installer: --installClient <dir> installs to the given directory.
    // Default would be ~/.minecraft which is wrong for our custom layout.
    const args = [...jvmOptions, '-jar', installerJar, '--installClient', mcDir]

    execFile(java, args, { cwd: mcDir, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (stdout && stdout.trim()) console.log('[NeoForge installer stdout]\n' + stdout)
      if (stderr && stderr.trim()) console.error('[NeoForge installer stderr]\n' + stderr)
      if (err) {
        if (fs.existsSync(versionJson)) {
          return resolve()
        }
        const detail = (stderr || '').trim() || err.message
        return reject(new Error('NeoForge telepítés sikertelen: ' + detail))
      }
      return resolve()
    })
  })

  if (fs.existsSync(installerJar)) fs.unlinkSync(installerJar)

  // ── 5. Persist installed version ────────────────────────────
  writeState({
    neoForgeVersion: latestLoader,
    neoForgeInstalledAt: new Date().toISOString(),
  })

  sendProgress('neoforge', 100, `NeoForge ${latestLoader} telepítve ✓`)
}

// ── Minecraft Assets + Libraries ─────────────────────────────

async function installMinecraft() {
  sendProgress('minecraft', 0, 'Minecraft 1.21.1 letöltése...')

  const mcDir = getGameDir()
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

// ── Modrinth Individual Mod Updates ───────────────────────────

/**
 * BLACKLIST: Mods that are known to cause crashes or are unwanted on the client.
 */
const CLEANUP_BLACKLIST = ['custom-splash-screen', 'customsplashscreen', 'mobsbegone', 'soundsbegone', 'interactic', 'battlecam'];

/**
 * Removes blacklisted mods from the mods folder.
 */
async function cleanupClientMods(onLog) {
  const instanceDir = getModpackDir()
  const modsDir = path.join(instanceDir, 'mods')
  if (!fs.existsSync(modsDir)) return

  const files = fs.readdirSync(modsDir)
  for (const file of files) {
    const lower = file.toLowerCase()
    if (CLEANUP_BLACKLIST.some(b => lower.includes(b))) {
      onLog?.(`[Cleanup] Hibás vagy tiltott mod eltávolítása: ${file}`)
      try {
        fs.unlinkSync(path.join(modsDir, file))
      } catch (e) {
        console.error(`[Cleanup-Hiba] Nem sikerült törölni: ${file}`, e.message)
      }
    }
  }
}

/**
 * Scans the mods folder and checks Modrinth for newer versions
 * compatible with the current MC version and Fabric.
 */
async function updateModsFromModrinth(loaderType = 'neoforge', onLog) {
  const instanceDir = getModpackDir()
  const modsDir = path.join(instanceDir, 'mods')
  if (!fs.existsSync(modsDir)) return

  onLog?.('[Modrinth] Modok frissítéseinek ellenőrzése (MC 1.21.1)...')

  try {
    const files = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'))
    const hashes = []
    const fileToInfo = {} // hash -> { file, fullPath }

    for (const file of files) {
      const fullPath = path.join(modsDir, file)
      try {
        const hash = await getFileHash(fullPath, 'sha1')
        hashes.push(hash)
        fileToInfo[hash] = { file, fullPath }
      } catch (e) {
        console.warn(`[Modrinth] Nem sikerült hash-elni: ${file}`, e.message)
      }
    }

    if (hashes.length === 0) return

    // Identify versions on Modrinth using hashes
    const versionMap = await modrinthRequest('/v2/version_files', 'POST', {
      hashes: hashes,
      algorithm: 'sha1'
    })

    const projectsToCheck = new Set()
    const hashToVersion = {}
    for (const hash in versionMap) {
      const v = versionMap[hash]
      hashToVersion[hash] = v
      projectsToCheck.add(v.project_id)
    }

    let updatedCount = 0
    for (const projectId of projectsToCheck) {
      // Get all versions for this project for MC 1.21.1 and the requested loader
      const query = `loaders=${encodeURIComponent(`["${loaderType}"]`)}&game_versions=${encodeURIComponent(`["${MC_VERSION}"]`)}`
      const versions = await modrinthRequest(`/v2/project/${projectId}/version?${query}`)
      // Sort by date (Modrinth usually does this, but to be sure)
      const releases = versions.filter(v => v.version_type === 'release')
      const latest = releases[0] || versions[0]
      
      if (!latest) continue

      // Find which of our local versions belong to this project
      const currentVersionsForProject = Object.values(hashToVersion).filter(v => v.project_id === projectId)
      
      // Check if we have an older version
      const isOutdated = currentVersionsForProject.some(v => new Date(v.date_published) < new Date(latest.date_published))

      if (isOutdated) {
        const newestFile = latest.files.find(f => f.primary) || latest.files[0]
        
        // We might have multiple local jars for the same project (unlikely but possible)
        // We'll replace the one that is oldest.
        const oldVersion = currentVersionsForProject[0]
        const oldHash = Object.keys(hashToVersion).find(h => hashToVersion[h].id === oldVersion.id)
        const oldFileInfo = fileToInfo[oldHash]

        if (oldFileInfo) {
          onLog?.(`[Modrinth] Frissítés: ${oldFileInfo.file} → ${newestFile.filename}`)
          const dest = path.join(modsDir, newestFile.filename)
          
          try {
            await downloadFile(newestFile.url, dest)
            // If the filename is different, remove the old one.
            if (fs.existsSync(oldFileInfo.fullPath) && oldFileInfo.fullPath !== dest) {
              fs.unlinkSync(oldFileInfo.fullPath)
            }
            updatedCount++
          } catch (dlErr) {
            onLog?.(`[Modrinth-Hiba] Nem sikerült letölteni: ${newestFile.filename}`)
          }
        }
      }
    }

    if (updatedCount > 0) {
      onLog?.(`[Modrinth] ${updatedCount} mod sikeresen frissítve.`)
    } else {
      onLog?.('[Modrinth] Minden mod naprakész.')
    }
  } catch (err) {
    onLog?.(`[Modrinth-Hiba] Ellenőrzés sikertelen: ${err.message}`)
  }
}

// ── Modpack Installation ─────────────────────────────────────

async function installModpack(serverUrl = '') {
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
  
  // ── 7. Custom Server Sync (immediately after install/update) ──
  if (serverUrl && serverUrl.trim() !== '') {
    try {
      console.log('[Sync] Automatikus szinkronizálás telepítés után...')
      await syncServerMods(serverUrl.trim(), instanceDir, (msg) => {
        sendProgress('modpack', 100, msg)
      })
    } catch (e) {
      console.warn('[Sync] Telepítés utáni szinkron hiba:', e.message)
    }
  }

  // 8. Cleanup Blacklisted/Broken Mods
  await cleanupClientMods((msg) => {
    sendProgress('modpack', 100, msg)
  })

  /* 
  // 9. Modrinth Mod Updates (ensure all mods are latest 1.21.1) ──
  try {
    await updateModsFromModrinth((msg) => {
      sendProgress('modpack', 100, msg)
    })
  } catch (e) {
    console.warn('[Modrinth] Hiba az egyedi modok frissítésekor:', e.message)
  }
  */

}

// ── Platform-Aware JVM Args Builder ────────────────────────

/**
 * Builds an optimal, platform-specific JVM argument list for Minecraft.
 *
 * Key techniques:
 *  • ZGC + ZGenerational  – low-pause GC ideal for game workloads
 *  • ZUncommit            – JVM returns unused heap pages back to the OS
 *                           (biggest RAM saver: ~15-25% reduction in resident set)
 *  • CompressedOops        – 32-bit object pointers in a 64-bit JVM (~10-15%
 *                           heap reduction for most Minecraft workloads)
 *  • StringDeduplication   – merges identical String objects in memory
 *  • TransparentHugePages  – Linux only: reduces TLB pressure on large heaps
 *  • LargePages            – Windows only: reduces TLB pressure (silent fallback)
 *  • UseNUMA               – Linux only: NUMA-aware allocation on multi-socket CPUs
 *
 * @param {number} ramMb   - Max heap in MB (from user setting)
 * @param {string} platform - process.platform value
 * @returns {string[]} JVM argument array
 */
function buildJvmArgs(ramMb, platform) {
  const maxMb = ramMb || 4096
  // SoftMaxHeapSize = 85% of max → JVM will uncommit memory above this limit
  // back to the OS when idle, keeping the resident set smaller
  const softMaxMb = Math.floor(maxMb * 0.85)

  // Common args that work well on all three platforms
  const commonArgs = [
    // ── Garbage Collector ──────────────────────────────────
    '-XX:+UseZGC',
    '-XX:+ZGenerational',           // Generational ZGC (Java 21+): shorter GC pauses
    '-XX:+ZUncommit',               // Return unused heap pages to the OS when idle
    '-XX:ZUncommitDelay=30',        // Wait 30s of inactivity before uncommitting
    `-XX:SoftMaxHeapSize=${softMaxMb}M`, // Soft ceiling – triggers uncommit above this

    // ── Pointer & Heap Compression ─────────────────────────
    '-XX:+UseCompressedOops',           // 32-bit object refs in 64-bit JVM (~10-15% heap saving)
    '-XX:+UseCompressedClassPointers',  // Compress class metadata pointers

    // ── String Memory Deduplication ────────────────────────
    '-XX:+UseStringDeduplication',      // Merge duplicate String objects
    '-XX:StringDeduplicationAgeThreshold=1', // Deduplicate after first GC cycle

    // ── JIT & Code Cache ───────────────────────────────────
    '-XX:+OptimizeStringConcat',        // JIT-optimize String concatenation
    '-XX:+UseCodeCacheFlushing',        // Flush JIT cache when full (mods generate lots of code)
    '-XX:ReservedCodeCacheSize=512m',   // Larger code cache limit (default 240m is too small)

    // ── Stability & Misc ───────────────────────────────────
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',           // Ignore System.gc() calls from mods
    '-XX:+PerfDisableSharedMem',        // Don't put perfdata in shared memory
    '-XX:ConcGCThreads=2',              // Concurrent GC threads
    '-XX:ParallelGCThreads=4',          // Parallel GC threads
    '-Dfml.ignorePatchDiscrepancies=true',
    '-Dfml.ignoreInvalidMinecraftCertificates=true',
  ]

  if (platform === 'linux') {
    return [
      ...commonArgs,
      // Transparent HugePage support: reduces TLB misses on large heaps.
      // If THPs are not enabled in the kernel, the JVM silently ignores this.
      '-XX:+UseTransparentHugePages',
      // NUMA-aware allocation: improves performance on multi-socket AMD/Intel CPUs
      '-XX:+UseNUMA',
    ]
  } else if (platform === 'darwin') {
    return [
      ...commonArgs,
      // macOS: no platform-specific page tricks available via JVM flags,
      // but we can still benefit from all the common optimizations above.
    ]
  } else {
    // Windows
    return [
      ...commonArgs,
      // Large Pages: reduces TLB pressure; requires "Lock pages in memory" privilege.
      // The JVM falls back silently if the privilege is missing – no crash risk.
      '-XX:+UseLargePages',
      '-XX:LargePageSizeInBytes=2m',
    ]
  }
}

// ── Public API ───────────────────────────────────────────────

async function install({ username, ram, serverUrl, loaderType = 'neoforge' }, onProgress) {
  progressCallback = onProgress

  migrateStructure()

  sendProgress('start', 0, 'Telepítés megkezdése...')

  await installJava()
  await installMinecraft()
  if (loaderType === 'fabric') {
    await installFabric()
  } else {
    await installNeoForge()
  }
  await installModpack(serverUrl)

  sendProgress('done', 100, 'Minden telepítve! Jó játékot! 🎮')
  progressCallback = null
}

async function launch({ username, uuid, ram, serverUrl, closeOnLaunch, loaderType = 'neoforge' }, onLog, onClose) {
  const ramMb = ram || 4096

  migrateStructure()

  const mcDir = getGameDir()
  const instanceDir = getModpackDir()
  const java = javaPath || getJavaExecutable()

  // Use the resolved (latest) loader version, or fall back to state file
  const state = readState()
  let loaderVersion, versionId
  if (loaderType === 'fabric') {
    loaderVersion = resolvedFabricLoaderVersion || state.fabricLoaderVersion || '0.16.9'
    versionId = `fabric-loader-${loaderVersion}-${MC_VERSION}`
    onLog?.(`[Launcher] Fabric: ${loaderVersion}`)
  } else {
    loaderVersion = resolvedNeoForgeVersion || state.neoForgeVersion || '21.1.230'
    versionId = `neoforge-${loaderVersion}`
    onLog?.(`[Launcher] NeoForge: ${loaderVersion}`)
  }

  // ── Unified Server Resolution ────────────────────────────────
  const DEFAULT_HOST = "94.72.100.43"
  const DEFAULT_SYNC_PORT = "8080"
  
  let rawInput = serverUrl?.trim() || DEFAULT_HOST
  let syncUrl = rawInput
  
  // Prepend http:// if missing
  if (!syncUrl.startsWith('http')) syncUrl = 'http://' + syncUrl
  
  // Parse to get host and check for port
  let targetHost = DEFAULT_HOST
  try {
    const urlObj = new URL(syncUrl)
    targetHost = urlObj.hostname
    
    // If no port was provided in raw input, append default sync port
    if (!urlObj.port && !rawInput.includes(':')) {
      syncUrl = `${urlObj.protocol}//${urlObj.hostname}:${DEFAULT_SYNC_PORT}`
    }
  } catch (e) {
    targetHost = rawInput.split(':')[0] || DEFAULT_HOST
    if (!rawInput.includes(':')) syncUrl = `http://${targetHost}:${DEFAULT_SYNC_PORT}`
  }

  onLog?.(`[Launcher] Szerver: ${targetHost} | Sync: ${syncUrl}`)

  // ── Sync Custom Server Mods ──────────────────────────────────
  try {
    await syncServerMods(syncUrl, instanceDir, onLog)
    // Log skin URL for reference
    await prepareLocalSkinConfig(instanceDir, username, syncUrl)
  } catch (e) {
    onLog?.(`[Sync-Hiba] Kivétel a szinkronizáció során: ${e.message}`)
  }
  // ── Cleanup Blacklisted/Broken Mods ─────────────────────────
  await cleanupClientMods(onLog)

  // ── Ensure Server is in servers.dat & Skip First-Launch Warnings ──
  try {
    await ensureFirstLaunchConfigs(instanceDir, targetHost)
    onLog?.(`[Launcher] Indítási konfigurációk ellenőrizve: ${targetHost}`)
  } catch (e) {
    onLog?.(`[Launcher-Hiba] Nem sikerült frissíteni a konfigurációkat: ${e.message}`)
  }

  const client = new Client()

  const opts = {
    authorization: uuid ? {
      access_token: 'null',
      client_token: 'null',
      uuid: uuid.replace(/-/g, ''), // MCLC often expects UUID without dashes for some fields
      name: username,
      user_properties: '{}'
    } : Authenticator.getAuth(username),
    root: mcDir,
    version: {
      number: MC_VERSION,
      type: 'release',
      custom: versionId,
    },
    memory: {
      max: `${ramMb}M`,
      // Min = 25% of max (floor 512 MB): avoids excessive early GC cycles while
      // still leaving headroom for the OS when the game hasn't loaded everything yet
      min: `${Math.max(512, Math.floor(ramMb * 0.25))}M`,
    },


    javaPath: java,
    gameDirectory: instanceDir,
    quickPlay: {
      type: 'multiplayer',
      identifier: `${targetHost}:25565`
    },
    overrides: {
      gameDirectory: instanceDir,
      customArgs: ['--quickPlayMultiplayer', `${targetHost}:25565`],
      // NeoForge only installs a JSON into its version dir, not a JAR.
      // MCLC must use the vanilla 1.21.1 client jar as the minecraft jar.
      minecraftJar: path.join(mcDir, 'versions', MC_VERSION, `${MC_VERSION}.jar`),
    },
    server: {
      host: targetHost,
      port: 25565
    },
    // Platform-optimised JVM args: ZUncommit returns unused heap to the OS,
    // CompressedOops shrinks pointer sizes, platform-specific page tricks
    // (THugePages on Linux, LargePages on Windows) reduce TLB pressure.
    customArgs: buildJvmArgs(ramMb, process.platform),


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

  // Handle "Close on Launch"
  if (closeOnLaunch) {
    onLog?.('[Launcher] Játék elindítva, launcher bezárása...')
    setTimeout(() => {
      app.quit()
    }, 5000) // Give it a few seconds to finish launching
  }
}


function isInstalled(loaderType = 'neoforge') {
  const state = readState()
  const modsDir = path.join(getModpackDir(), 'mods')
  const clientJar = path.join(getGameDir(), 'versions', MC_VERSION, `${MC_VERSION}.jar`)
  const javaExe = getJavaExecutable()
  const modpackOk = !!state.modpackVersionId && fs.existsSync(modsDir)
  
  const loaderOk = loaderType === 'fabric' ? !!state.fabricLoaderVersion : !!state.neoForgeVersion

  return {
    java: fs.existsSync(javaExe) && state.javaVersion === JAVA_VERSION_TARGET,
    minecraft: fs.existsSync(clientJar),
    modpack: modpackOk,
    modpackVersion: state.modpackVersionNumber || null,
    neoForgeVersion: state.neoForgeVersion || null,
    fabricVersion: state.fabricLoaderVersion || null,
    allDone: fs.existsSync(javaExe) && state.javaVersion === JAVA_VERSION_TARGET && fs.existsSync(clientJar) && modpackOk && loaderOk,
  }
}

/**
 * Lightweight update check – does NOT install, just returns available update info.
 * Called from the renderer (home screen) in the background.
 */
async function checkForUpdates() {
  const state = readState()
  const result = { modpack: null, neoforge: null, fabric: null }

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

  // NeoForge
  try {
    const loader = await fetchLatestNeoForgeVersion()
    if (loader !== state.neoForgeVersion) {
      result.neoforge = {
        currentVersion: state.neoForgeVersion || '?',
        latestVersion: loader,
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

/**
 * Logs the skin URL that the player can use in-game with /skin url <url>.
 * NOTE: SkinsRestorer is a server-side mod. It does NOT run in singleplayer
 * (integrated server). There is no reliable way to auto-apply skins in SP
 * without a dedicated client-side skin mod. The skin will be applied automatically
 * when the player joins the multiplayer server (SR applies it server-side).
 */
async function prepareLocalSkinConfig(instanceDir, username, serverUrl) {
  try {
    const baseUrl = serverUrl.replace(/\/+$/, '')
    const skinUrl = `${baseUrl}/skins/${username}.png`
    console.log(`[Launcher] Skin URL: ${skinUrl}`)
    console.log(`[Launcher] Multiplayer-ben a SkinsRestorer automatikusan alkalmazza a skint.`)
    console.log(`[Launcher] Singleplayer-ben in-game parancs: /skin url ${skinUrl}`)
  } catch (e) {
    console.warn(`[Launcher-Warning] Skin URL log hiba: ${e.message}`)
  }
}

/**
 * Ensures options.txt and servers.dat are ready for a seamless first launch.
 */
async function ensureFirstLaunchConfigs(instanceDir, host) {
  try {
    const defaultOptionsDir = path.join(instanceDir, 'config', 'defaultoptions')
    fse.ensureDirSync(defaultOptionsDir)
    
    const optionsPath = path.join(defaultOptionsDir, 'options.txt')
    let optionsContent = ''

    if (fs.existsSync(optionsPath)) {
      optionsContent = fs.readFileSync(optionsPath, 'utf8')
    }

    const settingsToEnsure = {
      'skipMultiplayerWarning': 'true',
      'onboardAccessibility': 'false',
      'joinedFirstServer': 'true',
      'tutorialStep': 'none',
      'realmsNotifications': 'false',
      'telemetryOptInExtra': 'false',
      'chatLinksPrompt': 'false',
      'showSubtitles': 'false',
      'autoJump': 'false',
      'syncChunkWrites': 'false'
    }

    let modified = false
    for (const [key, value] of Object.entries(settingsToEnsure)) {
      if (!optionsContent.includes(`${key}:`)) {
        optionsContent += `${key}:${value}\n`
        modified = true
      } else {
        const regex = new RegExp(`^${key}:.*`, 'm')
        const currentLine = optionsContent.match(regex)
        if (currentLine && !currentLine[0].includes(value)) {
          optionsContent = optionsContent.replace(regex, `${key}:${value}`)
          modified = true
        }
      }
    }

    if (modified) {
      fs.writeFileSync(optionsPath, optionsContent)
      console.log('[Launcher] Kezdeti beállítások (options.txt) frissítve.')
    }

    await updateServersDat(defaultOptionsDir, host)
  } catch (e) {
    console.error('[Launcher] Hiba a kezdeti beállításoknál:', e.message)
  }
}

/**
 * Updates or creates the servers.dat file to ensure the target server is in the list.
 * This writes a raw NBT buffer to avoid heavy dependencies.
 */
async function updateServersDat(instanceDir, host) {
  try {
    if (!host) host = "94.72.100.43" // Default fallback

    const name = "Cobblemon Universe"
    const serversDatPath = path.join(instanceDir, 'servers.dat')
    
    // Check if it already exists and if our host is in there
    if (fs.existsSync(serversDatPath)) {
      try {
        const existingData = fs.readFileSync(serversDatPath)
        // servers.dat is NOT compressed in modern MC
        if (existingData.includes(Buffer.from(host, 'utf8'))) {
          console.log(`[Launcher] A szerver (${host}) mar szerepel a listan.`)
          return
        }
      } catch (e) {
        console.warn('[Launcher] Meglevo servers.dat olvasasa sikertelen.')
      }
    }
    
    const nameBuf = Buffer.from(name, 'utf8')
    const hostBuf = Buffer.from(host, 'utf8')
    
    // NBT Structure for servers.dat:
    // Compound (root)
    //   List "servers" (Compound)
    //     Compound
    //       String "name": "Cobblemon Universe"
    //       String "ip": host
    //       Byte "acceptTextures": 1 (Always)
    //     End
    //   End
    // End
    
    const parts = [
      Buffer.from([0x0A, 0x00, 0x00]), // Root Compound
      Buffer.from([0x09, 0x00, 0x07]), // List Tag, Name "servers"
      Buffer.from("servers", 'utf8'),
      Buffer.from([0x0A]),             // Compound type
      Buffer.from([0x00, 0x00, 0x00, 0x01]), // Length 1
      
      Buffer.from([0x08, 0x00, 0x04]), // String "name"
      Buffer.from("name", 'utf8'),
      Buffer.from([Math.floor(nameBuf.length / 256), nameBuf.length % 256]),
      nameBuf,
      
      Buffer.from([0x08, 0x00, 0x02]), // String "ip"
      Buffer.from("ip", 'utf8'),
      Buffer.from([Math.floor(hostBuf.length / 256), hostBuf.length % 256]),
      hostBuf,

      Buffer.from([0x01, 0x00, 0x0E]), // Byte "acceptTextures"
      Buffer.from("acceptTextures", 'utf8'),
      Buffer.from([0x01]),             // Value: 1 (Enabled/Always)
      
      Buffer.from([0x00]),             // End element
      Buffer.from([0x00])              // End root
    ]
    
    const uncompressed = Buffer.concat(parts)
    fs.writeFileSync(serversDatPath, uncompressed)
  } catch (e) {
    console.error('[Launcher] servers.dat hiba:', e.message)
  }
}

module.exports = { install, launch, isInstalled, checkForUpdates, getModpackDir }
