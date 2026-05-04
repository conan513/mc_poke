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
  win32_arm64: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_aarch64_windows_hotspot_21.0.5_11.zip',
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

  sendProgress('java', 100, 'Java 21 telepítve ✓')
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

    // If a custom CA PEM was provided, import it into a PKCS12 truststore
    // and pass it to the JVM via -Djavax.net.ssl.trustStore.
    const pemPath = process.env.COBBLE_CA_PEM || path.join(getGameDir(), 'custom_ca.pem')
    let truststorePath = null
    const truststorePass = 'changeit'
    if (fs.existsSync(pemPath)) {
      try {
        // derive keytool path from java executable
        const getKeytoolPath = (javaExe) => {
          // common layouts: .../bin/java  -> .../bin/keytool(.exe)
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
          console.warn('[Truststore] keytool not found next to java; cannot create truststore automatically.')
          truststorePath = null
        }
      } catch (e) {
        console.warn('[Truststore] Error creating truststore:', e.message)
        truststorePath = null
      }
    }

    // Prepare JVM args; if we have a truststore, pass it as a JVM system property
    const jvmOptions = []
    if (truststorePath) {
      jvmOptions.push(`-Djavax.net.ssl.trustStore=${truststorePath}`)
      jvmOptions.push(`-Djavax.net.ssl.trustStorePassword=${truststorePass}`)
    }

    // On Windows, instruct the JVM to use the native Windows certificate store
    // so it trusts the same CAs as the OS (fixes PKIX / fabricmc.net SSL errors).
    if (process.platform === 'win32') {
      jvmOptions.push('-Djavax.net.ssl.trustStoreType=WINDOWS-ROOT')
    }

    // Optional insecure Java-level "trust-all" agent for installer debugging.
    // Enabled by setting INSTALLER_INSECURE_JAVA_AGENT=1 or INSTALLER_INSECURE=java-agent
    const insecureAgentEnabled = process.env.INSTALLER_INSECURE_JAVA_AGENT === '1' || process.env.INSTALLER_INSECURE === 'java-agent'
    if (insecureAgentEnabled) {
        // Prefer a prebuilt agent bundled with the app for reliability.
        const bundled = path.join(__dirname, 'insecure-resources', 'trust-all-agent.jar')
        const agentDir = path.join(getGameDir(), 'insecure-agent')
        fse.ensureDirSync(agentDir)
        const agentJar = path.join(agentDir, 'trust-all-agent.jar')
        try {
          if (fs.existsSync(bundled)) {
            // copy the bundled jar into the user data dir so we can reference it from there
            fse.copyFileSync(bundled, agentJar)
            jvmOptions.unshift(`-javaagent:${agentJar}`)
            console.warn('[InsecureAgent] Using bundled trust-all agent (INSECURE)')
          } else {
            console.warn('[InsecureAgent] No bundled agent found; skipping insecure agent')
          }
        } catch (e) {
          console.warn('[InsecureAgent] Error enabling bundled agent:', e.message)
        }
      }

    const args = [...jvmOptions, '-jar', installerJar, 'client', '-dir', mcDir, '-mcversion', MC_VERSION, '-loader', latestLoader, '-noprofile']

    execFile(java, args, { cwd: mcDir, windowsHide: true }, (err, stdout, stderr) => {
      if (stdout && stdout.trim()) console.log('[Fabric installer stdout]\n' + stdout)
      if (stderr && stderr.trim()) console.error('[Fabric installer stderr]\n' + stderr)
      if (err) {
        if (fs.existsSync(versionJson)) {
          // Installer reported error but version already exists — treat as success
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
async function updateModsFromModrinth(onLog) {
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
      // Get all versions for this project for MC 1.21.1 and Fabric
      const query = `loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(`["${MC_VERSION}"]`)}`
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

// ── Public API ───────────────────────────────────────────────

async function install({ username, ram, serverUrl }, onProgress) {
  progressCallback = onProgress

  migrateStructure()

  sendProgress('start', 0, 'Telepítés megkezdése...')

  await installJava()
  await installMinecraft()
  await installFabric()
  await installModpack(serverUrl)

  sendProgress('done', 100, 'Minden telepítve! Jó játékot! 🎮')
  progressCallback = null
}

async function launch({ username, uuid, ram, serverUrl }, onLog, onClose) {
  migrateStructure()

  const mcDir = getGameDir()
  const instanceDir = getModpackDir()
  const java = javaPath || getJavaExecutable()

  // Use the resolved (latest) loader version, or fall back to state file
  const state = readState()
  const loaderVersion = resolvedFabricLoaderVersion || state.fabricLoaderVersion || '0.16.9'
  const versionId = `fabric-loader-${loaderVersion}-${MC_VERSION}`

  onLog?.(`[Launcher] Fabric Loader: ${loaderVersion}`)

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

  // ── Ensure Server is in servers.dat ──────────────────────────
  try {
    await updateServersDat(instanceDir, targetHost)
    onLog?.(`[Launcher] Szerver lista ellenőrizve: ${targetHost}`)
  } catch (e) {
    onLog?.(`[Launcher-Hiba] Nem sikerült frissíteni a szerver listát: ${e.message}`)
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
      max: `${ram || 4096}M`,
      min: '2048M',
    },
    javaPath: java,
    gameDirectory: instanceDir,
    quickPlay: {
      type: 'multiplayer',
      identifier: `${targetHost}:25565`
    },
    overrides: {
      gameDirectory: instanceDir,
      customArgs: ['--quickPlayMultiplayer', `${targetHost}:25565`]
    },
    server: {
      host: targetHost,
      port: 25565
    },
    customArgs: [
      '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200',
      '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC', '-XX:G1NewSizePercent=30',
      '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M', '-XX:G1ReservePercent=20',
      '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4', '-XX:InitiatingHeapOccupancyPercent=15',
      '-XX:G1MixedGCLiveThresholdPercent=90', '-XX:G1RSetUpdatingPauseTimePercent=5',
      '-XX:SurvivorRatio=32', '-XX:+PerfDisableSharedMem', '-XX:MaxTenuringThreshold=1'
    ],
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
  const clientJar = path.join(getGameDir(), 'versions', MC_VERSION, `${MC_VERSION}.jar`)
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
    // Compound (root, nameless)
    //   List (name: "servers", type: Compound)
    //     Compound (entry 0, nameless)
    //       String (name: "name", value: "Cobblemon Universe")
    //       String (name: "ip", value: host)
    //     End
    //   End
    // End
    
    const parts = [
      Buffer.from([0x0A, 0x00, 0x00]), // Root Compound (Type 10, Name Length 0)
      
      Buffer.from([0x09, 0x00, 0x07]), // List Tag (Type 9), Name Length 7
      Buffer.from("servers", 'utf8'),
      Buffer.from([0x0A]),             // List element type: Compound (10)
      Buffer.from([0x00, 0x00, 0x00, 0x01]), // List length: 1
      
      // The first element of a List of Compounds starts directly with its tags, 
      // NOT with a 0x0A tag ID.
      
      Buffer.from([0x08, 0x00, 0x04]), // String Tag (8), Name Length 4: "name"
      Buffer.from("name", 'utf8'),
      Buffer.from([Math.floor(nameBuf.length / 256), nameBuf.length % 256]), // Value Length
      nameBuf,
      
      Buffer.from([0x08, 0x00, 0x02]), // String Tag (8), Name Length 2: "ip"
      Buffer.from("ip", 'utf8'),
      Buffer.from([Math.floor(hostBuf.length / 256), hostBuf.length % 256]), // Value Length
      hostBuf,
      
      Buffer.from([0x00]),             // End of Server Compound
      Buffer.from([0x00])              // End of Root Compound
    ]
    
    const uncompressed = Buffer.concat(parts)
    fs.writeFileSync(serversDatPath, uncompressed)
  } catch (e) {
    console.error('[Launcher] servers.dat hiba:', e.message)
  }
}

module.exports = { install, launch, isInstalled, checkForUpdates, getModpackDir }
