const fs = require('fs')
const fse = require('fs-extra')
const path = require('path')
const https = require('https')
const http = require('http')
const crypto = require('crypto')
const { exec, execFile } = require('child_process')
const AdmZip = require('adm-zip')

const LOG_FILE = path.join(__dirname, 'server-data', 'updater.log')
function logInfo(...args) {
  console.log(...args)
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${args.join(' ')}\n`) } catch(e) {}
}
function logError(...args) {
  console.error(...args)
  try { fs.appendFileSync(LOG_FILE, `[ERROR] [${new Date().toISOString()}] ${args.join(' ')}\n`) } catch(e) {}
}


const MODPACK_PROJECT_ID = 'Jkb29YJU'
const MC_VERSION = '1.21.1'
const MODRINTH_VERSIONS_URL = `https://api.modrinth.com/v2/project/${MODPACK_PROJECT_ID}/version?loaders=["fabric"]&game_versions=["${MC_VERSION}"]`
const FABRIC_META_URL = `https://meta.fabricmc.net/v2/versions/loader/${MC_VERSION}`
const FABRIC_INSTALLER_META_URL = 'https://meta.fabricmc.net/v2/versions/installer'

const SERVER_DIR = path.join(__dirname, 'server-data')
const MODS_DIR = path.join(SERVER_DIR, 'mods')
const MODS_BACKUP = path.join(SERVER_DIR, 'mods.old')
const STATE_FILE = path.join(SERVER_DIR, '.server-install-state.json')
const STATE_BAK = path.join(SERVER_DIR, '.server-install-state.json.bak')

const BLACKLISTED_MODS = [
  'no hunger', 'no ender dragon', 'soundsbegone',
  'interactic', 'custom-splash-screen', 'customsplashscreen', 'battlecam', 'lenientdeath',
  'biome-replacer',
  'fancymenu', 'konkrete', 'drippyloadingscreen', 'loadingscreen', 'notenoughcrashes'
];


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
    logInfo('[Java] Java 21 már telepítve.')
    return javaExe
  }

  const platform = process.platform
  const arch = process.arch
  const key = `${platform}_${arch === 'arm64' ? 'arm64' : 'x64'}`
  const url = JAVA_URLS[key] || JAVA_URLS[`${platform}_x64`]

  if (!url) throw new Error(`Nem támogatott platform Java letöltéshez: ${platform} ${arch}`)

  logInfo(`[Java] Java 21 letöltése (${platform} ${arch})...`)
  const ext = url.endsWith('.zip') ? '.zip' : '.tar.gz'
  const javaDl = path.join(SERVER_DIR, `java21${ext}`)

  await downloadFile(url, javaDl, (p) => {
    process.stdout.write(`\r[Java] Letöltés: ${Math.round(p * 100)}%`)
  })
  const javaTmpDir = javaDir + '.tmp'
  if (fs.existsSync(javaTmpDir)) fs.rmSync(javaTmpDir, { recursive: true, force: true })
  fs.mkdirSync(javaTmpDir, { recursive: true })

  if (ext === '.zip') {
    const zip = new AdmZip(javaDl)
    zip.extractAllTo(javaTmpDir, true)
  } else {
    await new Promise((resolve, reject) => {
      execFile('tar', ['-xzf', javaDl, '-C', javaTmpDir, '--strip-components=1'], (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  fs.unlinkSync(javaDl)

  if (fs.existsSync(javaDir)) fs.rmSync(javaDir, { recursive: true, force: true })
  fs.renameSync(javaTmpDir, javaDir)

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
  logInfo('[Java] Java 21 telepítése sikeres.')
  return resolvedJavaExe
}

function downloadFile(url, dest, options = {}) {
  const onProgress = typeof options === 'function' ? options : options.onProgress
  const expectedHash = options.hash
  const algorithm = options.algorithm || 'sha1'

  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const tmpDest = dest + '.tmp'
    
    const request = (targetUrl) => {
      const mod = targetUrl.startsWith('https') ? https : http
      mod.get(targetUrl, { headers: { 'User-Agent': 'CobbleServer/1.0' } }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode)) return request(res.headers.location)
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`))
        
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let downloaded = 0
        const file = fs.createWriteStream(tmpDest)
        
        res.on('data', chunk => {
          downloaded += chunk.length
          if (total > 0 && onProgress) onProgress(downloaded / total)
        })
        
        res.pipe(file)
        
        file.on('finish', async () => {
          file.close(async () => {
            try {
              if (expectedHash) {
                const actualHash = await getFileHash(tmpDest, algorithm)
                if (actualHash !== expectedHash) {
                  fs.unlinkSync(tmpDest)
                  return reject(new Error(`Hash hiba! Elvárt: ${expectedHash}, Kapott: ${actualHash}`))
                }
              }
              
              // Siker: átnevezés véglegesre
              if (fs.existsSync(dest)) fs.unlinkSync(dest)
              fs.renameSync(tmpDest, dest)
              resolve()
            } catch (err) {
              if (fs.existsSync(tmpDest)) fs.unlinkSync(tmpDest)
              reject(err)
            }
          })
        })
        
        file.on('error', (err) => {
          if (fs.existsSync(tmpDest)) fs.unlinkSync(tmpDest)
          reject(err)
        })
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
    if (!fs.existsSync(filePath)) return reject(new Error('Fájl nem található a hash-eléshez.'))
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
            logError(`[Modrinth-API] Error ${res.statusCode} on ${path}: ${data}`)
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
 * Creates a backup of current mods and state before an update.
 */
function backup() {
  logInfo('[Installer] Biztonsági mentés készítése frissítés előtt...')
  
  // State backup
  if (fs.existsSync(STATE_FILE)) {
    fs.copyFileSync(STATE_FILE, STATE_BAK)
  }

  // Mods backup is handled during the swap in install()
}

/**
 * Rolls back to the previous working version.
 */
function rollback() {
  logInfo('[Installer] ⚠️ VISSZAÁLLÍTÁS INDÍTÁSA...')

  try {
    // Restore mods
    if (fs.existsSync(MODS_BACKUP)) {
      logInfo('[Installer] Előző modok visszatöltése...')
      if (fs.existsSync(MODS_DIR)) fs.rmSync(MODS_DIR, { recursive: true, force: true })
      fs.renameSync(MODS_BACKUP, MODS_DIR)
    } else {
      logError('[Installer] Nem található mods.old mappa a visszaállításhoz!')
    }

    // Restore state
    if (fs.existsSync(STATE_BAK)) {
      logInfo('[Installer] Előző állapotfájl visszatöltése...')
      fs.copyFileSync(STATE_BAK, STATE_FILE)
      fs.unlinkSync(STATE_BAK)
    }

    logInfo('[Installer] ✅ Visszaállítás sikeres.')
  } catch (err) {
    logError(`[Installer] ❌ HIBA a visszaállítás során: ${err.message}`)
  }
}

/**
 * Deletes backup files after a successful update confirmation.
 */
function commitUpdate() {
  logInfo('[Installer] Frissítés véglegesítése (mentések törlése)...')
  if (fs.existsSync(MODS_BACKUP)) fs.rmSync(MODS_BACKUP, { recursive: true, force: true })
  if (fs.existsSync(STATE_BAK)) fs.unlinkSync(STATE_BAK)
}

/**
 * Scans the mods folder and checks Modrinth for newer versions
 * compatible with the current MC version and Fabric.
 */
async function updateModsFromModrinth() {
  if (!fs.existsSync(MODS_DIR)) {
    logInfo('[Modrinth] Mods mappa nem létezik, kihagyás.');
    return;
  }

  logInfo('[Modrinth] Modok frissítéseinek ellenőrzése (MC 1.21.1)...');

  try {
    const files = fs.readdirSync(MODS_DIR).filter(f => f.endsWith('.jar'));
    logInfo(`[Modrinth] ${files.length} .jar fájl találva a mods mappában.`);
    
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
      logInfo('[Modrinth] Nem sikerült hash-elni egyetlen fájlt sem.');
      return;
    }

    logInfo(`[Modrinth] Azonosítás a Modrinth API-val...`);
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

    logInfo(`[Modrinth] ${projectsToCheck.size} projekt azonosítva a Modrinth-en.`);

    let updatedCount = 0;
    for (const projectId of projectsToCheck) {
      // Felhasználói kérés: cobblemon-additions (W2pr9jyL) ne legyen frissítve soha
      if (projectId === 'W2pr9jyL') continue;
      try {
        const query = `loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(`["${MC_VERSION}"]`)}`
        const versions = await modrinthRequest(`/v2/project/${projectId}/version?${query}`);
        const releases = versions.filter(v => v.version_type === 'release');
        const latest = releases[0] || versions[0];
        
        if (!latest) {
          logInfo(`[Modrinth] Nincs kompatibilis verzió a projekthez: ${projectId}`);
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
            logInfo(`[Modrinth] FRISSÍTÉS: ${oldFileInfo.file} -> ${newestFile.filename} (${latest.version_number})`);
            const dest = path.join(MODS_DIR, newestFile.filename);
            
            await downloadFile(newestFile.url, dest, { hash: newestFile.hashes.sha1, algorithm: 'sha1' });
            if (fs.existsSync(oldFileInfo.fullPath) && oldFileInfo.fullPath !== dest) {
              fs.unlinkSync(oldFileInfo.fullPath);
            }
            updatedCount++;
          }
        }
      } catch (e) {
        logError(`[Modrinth-Hiba] Hiba a projekt ellenőrzésekor (${projectId}): ${e.message}`);
      }
    }

    if (updatedCount > 0) {
      logInfo(`[Modrinth] Szinkronizáció kész! ${updatedCount} mod frissítve.`);
    } else {
      logInfo('[Modrinth] Minden mod naprakész.');
    }
  } catch (err) {
    logError(`[Modrinth-Hiba] Végzetes hiba az ellenőrzés során: ${err.message}`);
  }
}

/**
 * Ensures specific extra mods are present.
 * NOTE: SkinsRestorer is NOT a Fabric mod – on Modrinth its loaders are
 * listed as "bungee", "velocity", "bukkit" etc. Filtering by loader=["fabric"]
 * returns no results and a wrong version is downloaded. We therefore query
 * SkinsRestorer WITHOUT a loader filter but WITH a game_version constraint.
 */
const EXTRA_MODS = [
  { slug: 'chipped',                        loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'creeper-firework',               loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'terrablender',                   loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'skinrestorer',                   loaders: ['fabric'], gameVersions: [MC_VERSION] },
  // Cobblemon extra mods
  { slug: 'player-locator-plus',            loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-mount-mastery',        loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-smartphone',           loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'trainer-accessories',            loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-rankeds',              loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'more-cobblemon-stats',           loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-max-level-catch-cap',  loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-capture-notification', loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-rustling-spots',       loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-cobbled-levels',       loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'village-spawn-point',            loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'easyauth',                       loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'serene-seasons',                 loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'seasonhud-fabric',               loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'easywhitelist',                  loaders: ['fabric'], gameVersions: [MC_VERSION] },
  // Új modok (felhasználói kérés)
  { slug: 'mobsbegone',                     loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'vmp-fabric',                     loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'fix-cobblemon-pokemon-experience', loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-poke-stops',           loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-pet-a-poke',           loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'pokemon-field-lab',              loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-pokerus',              loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'livelierpokemon',                loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'pokebike',                       loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemonmovedex',               loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-alpha-project',        loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemarks+',                   loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'rad-gyms',                       loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-underground-mining-minigame', loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobble-contests',                loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-trials-edition',       loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-battle-tower',         loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-simple-pokecenters',   loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-integrations',         loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'lootr',                          loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'lootrmon',                       loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-farmers',              loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-auto-battle',          loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon_expeditions',          loaders: ['fabric'], gameVersions: [MC_VERSION] },
  // distanthorizons ELTÁVOLÍTVA (felhasználói kérés) — serene-seasons-x-distant-horizons szintén
  // Függőségek (dependencies)
  { slug: 'cobblemore-library',             loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'pommel-held-item-models',        loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'figura',                         loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'admiral',                        loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'create-power-loader',            loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'create-fabric',                  loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'wild-battle-api',                loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cloth-config',                   loaders: ['fabric'], gameVersions: [MC_VERSION] }, // player-locator-plus
  { slug: 'farmers-delight',                loaders: ['fabric'], gameVersions: [MC_VERSION] }, // cobblemon-farmers
  { slug: 'expandability',                  loaders: ['fabric'], gameVersions: [MC_VERSION] }, // cobblemon_expeditions
  { slug: 'trainerattributeslib',           loaders: ['fabric'], gameVersions: [MC_VERSION] }, // trainer-accessories
  { slug: 'accessories',                    loaders: ['fabric'], gameVersions: [MC_VERSION] }, // trainer-accessories
  { slug: 'geckolib',                       loaders: ['fabric'], gameVersions: [MC_VERSION] }, // trainer-accessories
  { slug: 'collective',                     loaders: ['fabric'], gameVersions: [MC_VERSION] }, // village-spawn-point
  { slug: 'glitchcore',                     loaders: ['fabric'], gameVersions: [MC_VERSION] }, // serene-seasons (kötelező dep)
  { slug: 'forge-config-api-port',          loaders: ['fabric'], gameVersions: [MC_VERSION] }, // seasonhud-fabric
  // Cobblemon TCG
  { slug: 'cobbletcg',                      loaders: ['fabric'], gameVersions: [MC_VERSION] },
];

/**
 * Ensures specific extra mods are present.
 */
async function ensureExtraMods() {
  logInfo(`[Modrinth] Extra modok ellenőrzése: ${EXTRA_MODS.map(m => m.slug).join(', ')}...`);

  for (const { slug, loaders, gameVersions } of EXTRA_MODS) {
    try {
      const params = [];
      if (loaders)      params.push(`loaders=${encodeURIComponent(JSON.stringify(loaders))}`);
      if (gameVersions) params.push(`game_versions=${encodeURIComponent(JSON.stringify(gameVersions))}`);
      const qs = params.length ? '?' + params.join('&') : '';

      const versions = await modrinthRequest(`/v2/project/${slug}/version${qs}`);
      const latest = versions.filter(v => v.version_type === 'release')[0] || versions[0];

      if (!latest) {
        logInfo(`[Modrinth] Nincs megfelelő verzió: ${slug} (MC ${MC_VERSION})`);
        continue;
      }

      logInfo(`[Modrinth] ${slug} → ${latest.version_number}`);

      const file = latest.files.find(f => f.primary) || latest.files[0];
      const dest = path.join(MODS_DIR, file.filename);

      const existingFiles = fs.readdirSync(MODS_DIR);
      const isPresent = existingFiles.some(f => f.toLowerCase().includes(slug.toLowerCase()));

      if (!isPresent) {
        logInfo(`[Modrinth] Extra mod letöltése: ${slug} -> ${file.filename}`);
        await downloadFile(file.url, dest, { hash: file.hashes.sha1, algorithm: 'sha1' });
      } else {
        logInfo(`[Modrinth] Extra mod már jelen van: ${slug}`);
      }
    } catch (e) {
      logError(`[Modrinth-Hiba] Extra mod hiba (${slug}): ${e.message}`);
    }
  }
}

/**
 * Removes any mods that are on the blacklist from the mods folder.
 */
async function cleanupBlacklistedMods() {
  if (fs.existsSync(MODS_DIR)) {
    const files = fs.readdirSync(MODS_DIR);
    for (const file of files) {
      const lower = file.toLowerCase();
      if (BLACKLISTED_MODS.some(b => lower.includes(b))) {
        logInfo(`[Installer] Feketelistás mod törlése: ${file}`);
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

async function verifyIntegrity(state) {
  logInfo('[Installer] Integritás ellenőrzése...')
  
  // 1. Java check
  const javaExe = getJavaExecutable()
  if (!fs.existsSync(javaExe)) {
    console.warn('[Installer] Java végrehajtható nem található, újratelepítés szükséges.')
    return false
  }

  // 2. Fabric check
  const launchJar = path.join(SERVER_DIR, 'fabric-server-launch.jar')
  if (!fs.existsSync(launchJar)) {
    console.warn('[Installer] Fabric szerver jar nem található, újratelepítés szükséges.')
    return false
  }

  // 3. Modpack check
  if (!fs.existsSync(MODS_DIR) || fs.readdirSync(MODS_DIR).length === 0) {
    console.warn('[Installer] Mods mappa üres vagy hiányzik, modpack újratelepítése szükséges.')
    return false
  }

  // 4. Blacklist change check
  const currentBlacklist = JSON.stringify(BLACKLISTED_MODS)
  if (state.blacklistedMods !== currentBlacklist) {
    console.warn('[Installer] Feketelista megváltozott, modpack frissítése szükséges.')
    return false
  }

  // 5. Detailed file check based on .modpack-files.json
  const modpackFilesPath = path.join(SERVER_DIR, '.modpack-files.json')
  if (fs.existsSync(modpackFilesPath)) {
    try {
      const expectedFiles = JSON.parse(fs.readFileSync(modpackFilesPath, 'utf8'))
      for (const file of expectedFiles) {
        if (!fs.existsSync(path.join(MODS_DIR, file))) {
          console.warn(`[Installer] Hiányzó modpack fájl észlelve: ${file}, modpack újratelepítése szükséges.`)
          return false
        }
      }
    } catch (e) {
      console.warn('[Installer] Hiba a .modpack-files.json olvasásakor, újratelepítés javasolt.')
      return false
    }
  }

  // 6. Extra mods list check
  const currentExtraMods = JSON.stringify(EXTRA_MODS.map(m => m.slug))
  if (state.extraMods !== currentExtraMods) {
    console.warn('[Installer] Extra modok listája megváltozott, frissítés szükséges.')
    return false
  }

  return true
}

async function install() {
  logInfo('[Installer] Indítás...')

  // 0. Java 21
  const javaPath = await installJava()

  fs.mkdirSync(MODS_DIR, { recursive: true })

  // 1. Modpack check & download
  logInfo('[Installer] Keresem a legfrissebb Cobbleverse modpackot...')
  const versions = await fetchJson(MODRINTH_VERSIONS_URL)
  const latestPack = versions.filter(v => v.version_type === 'release')[0] || versions[0]
  const file = latestPack.files.find(f => f.primary) || latestPack.files[0]
  const stateFile = path.join(SERVER_DIR, '.server-install-state.json')

  let state = {}
  if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))

  const integrityOk = await verifyIntegrity(state)
  const lastCheck = state.lastCheckTime || 0
  const isFresh = (Date.now() - lastCheck) < 12 * 3600 * 1000 // 12 órán belüli ellenőrzés "friss"

  if (state.modpackId !== latestPack.id || !integrityOk) {
    backup()
    logInfo(`[Installer] Modpack telepítése/frissítése: ${latestPack.version_number}`)
    const mrpackPath = path.join(SERVER_DIR, 'modpack.mrpack')
    const MODS_STAGING = path.join(SERVER_DIR, 'mods.new')

    // Clean staging area
    if (fs.existsSync(MODS_STAGING)) fs.rmSync(MODS_STAGING, { recursive: true, force: true })
    fs.mkdirSync(MODS_STAGING, { recursive: true })

    try {
      await downloadFile(file.url, mrpackPath, {
        hash: file.hashes.sha1,
        onProgress: p => {
          process.stdout.write(`\r[Installer] Modpack letöltése: ${Math.round(p * 100)}%`)
        }
      })
      logInfo('\n[Installer] Kicsomagolás...')

      const zip = new AdmZip(mrpackPath)
      const index = JSON.parse(zip.readAsText('modrinth.index.json'))

      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue
        const lowerName = entry.entryName.toLowerCase()
        if (BLACKLISTED_MODS.some(b => lowerName.includes(b))) continue

        let destPath = null
        if (entry.entryName.startsWith('server-overrides/')) {
          destPath = path.join(SERVER_DIR, entry.entryName.slice('server-overrides/'.length))
        } else if (entry.entryName.startsWith('overrides/')) {
          const checkPath = path.join(SERVER_DIR, entry.entryName.slice('overrides/'.length))
          if (!fs.existsSync(checkPath)) destPath = checkPath
        }
        if (destPath) {
          fs.mkdirSync(path.dirname(destPath), { recursive: true })
          fs.writeFileSync(destPath, entry.getData())
        }
      }

      const files = index.files || []
      const serverFiles = files.filter(f => {
        if (f.env && f.env.server === 'unsupported') return false
        const lowerPath = f.path.toLowerCase()
        if (BLACKLISTED_MODS.some(b => lowerPath.includes(b))) return false
        return true
      })
      
      logInfo(`[Installer] Szerver modok letöltése (${serverFiles.length} db) a staging mappába...`)

      const baseFilenames = []
      let done = 0
      for (let i = 0; i < serverFiles.length; i += 5) {
        const batch = serverFiles.slice(i, i + 5)
        await Promise.all(batch.map(async f => {
          const filename = path.basename(f.path)
          const dest = path.join(MODS_STAGING, filename)
          baseFilenames.push(filename)
          const downloadUrl = f.downloads?.[0]
          if (downloadUrl) {
            await downloadFile(downloadUrl, dest, { hash: f.hashes.sha1 }).catch(e => {
               logError(`\n[Installer] Hiba a mod letöltésekor (${filename}): ${e.message}`)
               throw e
            })
          }
          done++
        }))
        process.stdout.write(`\r[Installer] Modok: ${done}/${serverFiles.length}`)
      }
      logInfo()

      logInfo('[Installer] Modok cseréje...')
      if (fs.existsSync(MODS_BACKUP)) fs.rmSync(MODS_BACKUP, { recursive: true, force: true })
      if (fs.existsSync(MODS_DIR)) fs.renameSync(MODS_DIR, MODS_BACKUP)
      fs.renameSync(MODS_STAGING, MODS_DIR)

      fs.writeFileSync(path.join(SERVER_DIR, '.modpack-files.json'), JSON.stringify(baseFilenames, null, 2))

      fs.unlinkSync(mrpackPath)
      // MODS_BACKUP megtartva a commitUpdate()-ig

      state.modpackId = latestPack.id
      state.blacklistedMods = JSON.stringify(BLACKLISTED_MODS)
      state.extraMods = JSON.stringify(EXTRA_MODS.map(m => m.slug))
      state.lastCheckTime = Date.now()
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
      logInfo('[Installer] Modpack frissítés sikeres.')

    } catch (err) {
      logError(`\n[Installer] HIBA a modpack telepítésekor: ${err.message}`)
      logInfo('[Installer] Visszaállítás...')
      if (fs.existsSync(MODS_STAGING)) fs.rmSync(MODS_STAGING, { recursive: true, force: true })
      throw err
    }
  } else if (isFresh) {
    logInfo(`[Installer] Modpack (${latestPack.version_number}) rendben. (Utolsó ellenőrzés: ${new Date(lastCheck).toLocaleString('hu-HU')})`)
    // Csak a modpack letöltést ugorjuk át, de a lenti cleanup/extra mods részekre továbbmegyünk
  } else {
    logInfo(`[Installer] Modpack verzió egyezik, de frissítések ellenőrzése szükséges...`)
  }

  // 2. Fabric Server Install
  const fv = await getLatestFabric()
  const launchJar = path.join(SERVER_DIR, 'fabric-server-launch.jar')

  if (state.fabricLoader !== fv.loader || !fs.existsSync(launchJar)) {
    logInfo(`[Installer] Fabric Server ${fv.loader} telepítése...`)
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
    logInfo(`[Installer] Fabric Server (${fv.loader}) már telepítve.`)
  }

  // 3. EULA
  const eulaPath = path.join(SERVER_DIR, 'eula.txt')
  if (!fs.existsSync(eulaPath) || !fs.readFileSync(eulaPath, 'utf8').includes('eula=true')) {
    fs.writeFileSync(eulaPath, 'eula=true\n')
    logInfo('[Installer] EULA automatikusan elfogadva.')
  }

  // 3b. server.properties – optimalizált beállítások (offline mód, view-distance)
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
      'view-distance=8',
      'simulation-distance=6'
    ].join('\n') + '\n')
    logInfo('[Installer] server.properties létrehozva (online-mode=false, DH optimalizált).')
  } else {
    // A fájl már létezik – beállítások ellenőrzése
    let props = fs.readFileSync(serverPropsPath, 'utf8')
    let modified = false
    
    if (/^online-mode\s*=\s*true/m.test(props)) {
      props = props.replace(/^online-mode\s*=\s*true/m, 'online-mode=false')
      modified = true
    } else if (!/^online-mode\s*=/m.test(props)) {
      props = props.trimEnd() + '\nonline-mode=false\n'
      modified = true
    }

    if (/^view-distance\s*=\s*(?!8$).*/m.test(props)) {
      props = props.replace(/^view-distance\s*=.*/m, 'view-distance=8')
      modified = true
    } else if (!/^view-distance\s*=/m.test(props)) {
      props = props.trimEnd() + '\nview-distance=8\n'
      modified = true
    }

    if (/^simulation-distance\s*=\s*(?!6$).*/m.test(props)) {
      props = props.replace(/^simulation-distance\s*=.*/m, 'simulation-distance=6')
      modified = true
    } else if (!/^simulation-distance\s*=/m.test(props)) {
      props = props.trimEnd() + '\nsimulation-distance=6\n'
      modified = true
    }

    if (modified) {
      fs.writeFileSync(serverPropsPath, props)
      logInfo('[Installer] server.properties frissítve (offline mód, view/simulation distance DH-hoz).')
    } else {
      logInfo('[Installer] server.properties megfelelő, nincs teendő.')
    }
  }

  // 4. Extra Mods (Chipped, TerraBlender)
  await ensureExtraMods()

  // 6. Blacklist Cleanup (Ensure unwanted mods are gone)
  await cleanupBlacklistedMods()

  // 7. Modrinth Mod Updates
  await updateModsFromModrinth()

  // Regenerate .modpack-files.json from the actual current mods folder.
  // updateModsFromModrinth() may have replaced jars (e.g. 4.0.2 → 4.0.3),
  // so the old filenames in .modpack-files.json would be stale, causing a
  // false integrity failure and a full reinstall on every subsequent startup.
  if (fs.existsSync(MODS_DIR)) {
    const currentJars = fs.readdirSync(MODS_DIR).filter(f => f.endsWith('.jar'))
    fs.writeFileSync(
      path.join(SERVER_DIR, '.modpack-files.json'),
      JSON.stringify(currentJars, null, 2)
    )
    logInfo(`[Installer] .modpack-files.json frissítve (${currentJars.length} mod).`)
  }

  state.lastCheckTime = Date.now()
  state.blacklistedMods = JSON.stringify(BLACKLISTED_MODS)
  state.extraMods = JSON.stringify(EXTRA_MODS.map(m => m.slug))
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))

  logInfo('[Installer] Telepítés/frissítés sikeres! Minden készen áll.')

  return javaPath
}

module.exports = { install, downloadFile, rollback, commitUpdate, logInfo, logError }
