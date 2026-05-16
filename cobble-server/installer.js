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
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${args.join(' ')}\n`) } catch (e) { }
}
function logError(...args) {
  console.error(...args)
  try { fs.appendFileSync(LOG_FILE, `[ERROR] [${new Date().toISOString()}] ${args.join(' ')}\n`) } catch (e) { }
}


const MODPACK_PROJECT_ID = 'Jkb29YJU'
const MC_VERSION = '1.21.1'
// Modpack letöltése Fabric-alapú (overrides/konfig/datapack miatt), de mod JAR-okat nem töltjük le belőle
const MODRINTH_VERSIONS_URL = `https://api.modrinth.com/v2/project/${MODPACK_PROJECT_ID}/version?loaders=["fabric"]&game_versions=["${MC_VERSION}"]`
// NeoForge maven meta
const NEOFORGE_MAVEN_META = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml'

const SERVER_DIR = path.join(__dirname, 'server-data')
const MODS_DIR = path.join(SERVER_DIR, 'mods')
const CLIENT_MODS_DIR = path.join(SERVER_DIR, 'client-mods')
const DATAPACKS_DIR = path.join(SERVER_DIR, 'datapacks')
const MODS_BACKUP = path.join(SERVER_DIR, 'mods.old')
const STATE_FILE = path.join(SERVER_DIR, '.server-install-state.json')
const STATE_BAK = path.join(SERVER_DIR, '.server-install-state.json.bak')

const BLACKLISTED_MODS = [
  'no hunger', 'no ender dragon', 'soundsbegone',
  'interactic', 'custom-splash-screen', 'customsplashscreen', 'battlecam', 'lenientdeath',
  'biome-replacer', 'biomereplacer', 'nocubes', 'mobsbegone',
  'fancymenu', 'konkrete', 'drippyloadingscreen', 'loadingscreen', 'notenoughcrashes',
  'figura', 'admiral',
  'cobblemon-rankeds', 'cobblemau',
  'vmp-fabric', 'lag-protection', 'lag_protection',
  'cobblelagclear', 'itemclearlag', 'fix-attack-lag', 'no-entity-lag',
  'rustlingspot', 'mikeskills', 'easyauth', 'seasonhud-fabric'
];


// Oracle GraalVM 21 – a volt GraalVM Enterprise Edition utóda (2023-tól ingyenes).
// Minecraft benchmark szerint chunk-generálásban 20%+ gyorsabb a standard Temurin-nél.
// Forrás: https://github.com/brucethemoose/Minecraft-Performance-Flags-Benchmarks
// Letöltési oldal: https://www.oracle.com/java/technologies/downloads/#graalvmjava21
const JAVA_URLS = {
  linux_x64:    'https://download.oracle.com/graalvm/21/latest/graalvm-jdk-21_linux-x64_bin.tar.gz',
  linux_arm64:  'https://download.oracle.com/graalvm/21/latest/graalvm-jdk-21_linux-aarch64_bin.tar.gz',
  win32_x64:    'https://download.oracle.com/graalvm/21/latest/graalvm-jdk-21_windows-x64_bin.zip',
  darwin_x64:   'https://download.oracle.com/graalvm/21/latest/graalvm-jdk-21_macos-x64_bin.tar.gz',
  darwin_arm64: 'https://download.oracle.com/graalvm/21/latest/graalvm-jdk-21_macos-aarch64_bin.tar.gz',
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
    logInfo('[Java] Oracle GraalVM 21 már telepítve.')
    return javaExe
  }

  const platform = process.platform
  const arch = process.arch
  const key = `${platform}_${arch === 'arm64' ? 'arm64' : 'x64'}`
  const url = JAVA_URLS[key] || JAVA_URLS[`${platform}_x64`]

  if (!url) throw new Error(`Nem támogatott platform Java letöltéshez: ${platform} ${arch}`)

  logInfo(`[Java] Oracle GraalVM 21 letöltése (${platform} ${arch})...`)
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
  logInfo('[Java] Oracle GraalVM 21 telepítése sikeres.')
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
      try {
        const oldVersion = Object.values(hashToVersion).find(v => v.project_id === projectId);
        
        // Skip update if this mod is pinned in EXTRA_MODS
        const isPinned = EXTRA_MODS.some(m => m.version && (m.slug === oldVersion?.slug || m.slug === projectId || m.projectId === projectId));
        if (isPinned) {
          logInfo(`[Modrinth] Frissítés kihagyva (pinelve): ${oldVersion?.slug || projectId}`);
          continue;
        }

        let loadersArray = ['neoforge', 'fabric'];
        if (oldVersion && oldVersion.loaders) {
          loadersArray = oldVersion.loaders.filter(l => l === 'neoforge' || l === 'fabric');
          if (loadersArray.length === 0) loadersArray = ['neoforge', 'fabric'];
        }

        const query = `loaders=${encodeURIComponent(JSON.stringify(loadersArray))}&game_versions=${encodeURIComponent(`["${MC_VERSION}"]`)}`
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
 */
const EXTRA_MODS = [
  // === SINYTRA CONNECTOR (Fabric modok futtatása NeoForge-on) ===
  // Sinytra Connector + Forgified Fabric API együtt kell a Fabric-only modokhoz
  { slug: 'connector',                      loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'connector-extras',               loaders: ['neoforge'], gameVersions: [MC_VERSION] },

  { slug: 'forgified-fabric-api',           loaders: ['neoforge'], gameVersions: [MC_VERSION] },

  // === CORE MODOK (NeoForge natív) ===
  { slug: 'cobblemon',                      loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'architectury-api',               loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'kotlin-for-forge',               loaders: ['neoforge'], gameVersions: [MC_VERSION] },

  // === NEOFORGE NATÍV MODOK ===
  { slug: 'chipped',                        loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'creeper-firework',               loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'terrablender',                   loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'skinrestorer',                   loaders: ['neoforge'], gameVersions: [MC_VERSION] },

  // Cobblemon extra modok (NeoForge natív)
  { slug: 'cobblemon-smartphone',           loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'more-cobblemon-stats',           loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-cobbled-levels',       loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'village-spawn-point',            loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'serene-seasons',                 loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'fix-cobblemon-pokemon-experience', loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-pokestops',            loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'pokemon-field-lab',              loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-pokerus',              loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'livelierpokemon',                loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'pokebike',                       loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-alpha-project',        loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'rad-gyms',                       loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobble-contests',                loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-trials-edition',       loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-battle-tower',         loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-simple-pokecenters',   loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-integrations',         loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'lootr',                          loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'lootrmon',                       loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemonoptimizer',             loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-tents',                loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-snap',                 loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-villager-overhaul',    loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'modern-ui',                      loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'tt20',                           loaders: ['neoforge'], gameVersions: [MC_VERSION] },

  // Függőségek (NeoForge natív)
  { slug: 'cobblemore-library',             loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'create',                         loaders: ['neoforge'], gameVersions: [MC_VERSION] }, // create-fabric helyett
  { slug: 'create-power-loader',            loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'wild-battle-api',                loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'jade',                           loaders: ['neoforge'], gameVersions: [MC_VERSION] }, // cobblemon-pokestops igényli
  { slug: 'rctapi',                         loaders: ['neoforge'], gameVersions: [MC_VERSION] }, // cobblemon-battle-tower igényli
  { slug: 'balm',                           loaders: ['neoforge'], gameVersions: [MC_VERSION] }, // waystones, netherportalfix igényli
  { slug: 'cloth-config',                   loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'farmers-delight',                loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'accessories',                    loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'owo-lib',                        loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'resourceful-lib',                loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'geckolib',                       loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'collective',                     loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'glitchcore',                     loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'forge-config-api-port',          loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'servercore',                     loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'spark',                          loaders: ['neoforge'], gameVersions: [MC_VERSION] },

  // === COBBLEMON ADDONS (NeoForge – a crashlogból hiányoztak) ===
  { slug: 'cobbledollars',                  loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobbreeding',                    loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblenav',                      loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-tim-core',             loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-capture-xp',           loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-fight-or-flight-reborn', loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemonraiddens',              loaders: ['neoforge'], version: '0.7.2+1.21.1', projectId: 'GebWh45l', gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-battle-extras',        loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'catch-rate-display',             loaders: ['neoforge'], gameVersions: [MC_VERSION] },

  // Teljesítmény (NeoForge natív)
  { slug: 'ksyxis',                         loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'scalablelux',                    loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'lmd',                            loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'packet-fixer',                   loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'almanac',                        loaders: ['neoforge'], gameVersions: [MC_VERSION] },

  // === FABRIC-ONLY MODOK (Sinytra Connector futtatja ezeket) ===
  { slug: 'fabric-language-kotlin',         loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'player-locator-plus',            loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-mount-mastery',        loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'trainer-accessories',            loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-max-level-catch-cap',  loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-capture-notification', loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'basic-login',                    loaders: ['neoforge'], gameVersions: [MC_VERSION] },
  { slug: 'easywhitelist',                  loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobbletcg',                      loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-pet-a-poke',           loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-underground-mining-minigame', loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-farmers',              loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon-auto-battle',          loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'trainer-pass',                   loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'tc-cobble-flight',               loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'pommel-held-item-models',        loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'trainerattributeslib',           loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'krypton',                        loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemonmovedex',               loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemarks+',                   loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'cobblemon_expeditions',          loaders: ['fabric'], gameVersions: [MC_VERSION] },
  { slug: 'seasonhud',                      loaders: ['neoforge'], version: '1.21.1-2.0.3', projectId: 'VNjUn3NA', gameVersions: [MC_VERSION], isClientOnly: true },
];

/**
 * Datapacks to be downloaded from CurseForge.
 * ID is the project ID from the sidebar.
 */
const EXTRA_DATAPACKS = [
  { id: '1474379', name: 'cobblemoncitytowns' },
];

/**
 * Mods to be downloaded from CurseForge.
 */
const CURSEFORGE_MODS = [
  { id: '1534055', name: 'cobblemon-nests-dens' },
];

/**
 * Közvetlen letöltésű modok (pl. GitHub release)
 */
const CUSTOM_DIRECT_MODS = [
  { url: 'https://github.com/zlainsama/PeacefulSurface/releases/download/1.21.1-v1c-fabric/peacefulsurface-1.21.1-v1c-fabric.jar', name: 'peacefulsurface-1.21.1-v1c-fabric.jar' }
];

/**
 * Ensures specific extra mods are present.
 */
async function ensureExtraMods() {
  logInfo(`[Modrinth] Extra modok ellenőrzése: ${EXTRA_MODS.map(m => m.slug).join(', ')}...`);

  for (const { slug, loaders, gameVersions, isDatapack, isClientOnly } of EXTRA_MODS) {
    try {
      const params = [];
      if (loaders) params.push(`loaders=${encodeURIComponent(JSON.stringify(loaders))}`);
      if (gameVersions) params.push(`game_versions=${encodeURIComponent(JSON.stringify(gameVersions))}`);
      const qs = params.length ? '?' + params.join('&') : '';

      const versions = await modrinthRequest(`/v2/project/${slug}/version${qs}`);
      let latest = versions.filter(v => v.version_type === 'release')[0] || versions[0];
      
      const pinnedVersion = EXTRA_MODS.find(m => m.slug === slug)?.version;
      if (pinnedVersion) {
        latest = versions.find(v => v.version_number === pinnedVersion) || latest;
      }

      if (!latest) {
        logInfo(`[Modrinth] Nincs megfelelő verzió: ${slug} (MC ${MC_VERSION})`);
        continue;
      }

      logInfo(`[Modrinth] ${slug} → ${latest.version_number}`);

      const file = latest.files.find(f => f.primary) || latest.files[0];
      const targetDir = isDatapack ? DATAPACKS_DIR : (isClientOnly ? CLIENT_MODS_DIR : MODS_DIR);
      const dest = path.join(targetDir, file.filename);

      const isPresent = fs.existsSync(dest);

      if (!isPresent) {
        logInfo(`[Modrinth] Extra ${isDatapack ? 'datapack' : 'mod'} letöltése: ${slug} -> ${file.filename}`);
        await downloadFile(file.url, dest, { hash: file.hashes.sha1, algorithm: 'sha1' });
      } else {
        logInfo(`[Modrinth] Extra ${isDatapack ? 'datapack' : 'mod'} már jelen van: ${slug}`);
      }
    } catch (e) {
      logError(`[Modrinth-Hiba] Extra mod hiba (${slug}): ${e.message}`);
    }
  }
}

/**
 * Generic CurseForge API request helper (uses website internal API).
 */
async function curseforgeRequest(projectId, gameVersion, loaderType = null) {
  let url = `https://www.curseforge.com/api/v1/mods/${projectId}/files?gameVersion=${gameVersion}`;
  if (loaderType) url += `&modLoaderType=${loaderType}`;
  return fetchJson(url);
}

/**
 * Ensures specific extra datapacks from CurseForge are present.
 */
async function ensureExtraDatapacks() {
  if (!fs.existsSync(DATAPACKS_DIR)) fs.mkdirSync(DATAPACKS_DIR, { recursive: true });
  logInfo(`[CurseForge] Datapackek ellenőrzése: ${EXTRA_DATAPACKS.map(d => d.name).join(', ')}...`);

  for (const { id, name } of EXTRA_DATAPACKS) {
    try {
      const response = await curseforgeRequest(id, MC_VERSION);
      const files = response.data || [];
      const latest = files[0]; // Assuming sorted by date descending

      if (!latest) {
        logInfo(`[CurseForge] Nincs megfelelő verzió: ${name} (MC ${MC_VERSION})`);
        continue;
      }

      const latestFilename = latest.fileName || `${name}.zip`;
      const dest = path.join(DATAPACKS_DIR, latestFilename);

      // Check if we already have this specific file or a file starting with the same name
      const existingFiles = fs.readdirSync(DATAPACKS_DIR);
      const isPresent = existingFiles.some(f => f === latestFilename);

      if (!isPresent) {
        logInfo(`[CurseForge] Datapack letöltése: ${name} -> ${latestFilename}`);
        // Remove old versions of the same datapack if they exist
        for (const f of existingFiles) {
          if (f.toLowerCase().includes(name.toLowerCase()) && f !== latestFilename) {
            logInfo(`[CurseForge] Régi verzió törlése: ${f}`);
            fs.unlinkSync(path.join(DATAPACKS_DIR, f));
          }
        }

        const downloadUrl = `https://www.curseforge.com/api/v1/mods/${id}/files/${latest.id}/download`;
        await downloadFile(downloadUrl, dest);
      } else {
        logInfo(`[CurseForge] Datapack már naprakész: ${name}`);
      }
    } catch (e) {
      logError(`[CurseForge-Hiba] Datapack hiba (${name}): ${e.message}`);
    }
  }
}

/**
 * Ensures specific extra mods from CurseForge are present.
 */
async function ensureCurseForgeMods() {
  if (!fs.existsSync(MODS_DIR)) fs.mkdirSync(MODS_DIR, { recursive: true });
  logInfo(`[CurseForge] Modok ellenőrzése: ${CURSEFORGE_MODS.map(m => m.name).join(', ')}...`);

  for (const { id, name, fileId } of CURSEFORGE_MODS) {
    try {
      let latest;
      if (fileId) {
        // Use fixed file ID
        latest = { id: fileId, fileName: `${name}.jar` }; // fileName will be refined if possible or used as fallback
      } else {
        // modLoaderType: 6 = NeoForge (4 = Fabric)
        const response = await curseforgeRequest(id, MC_VERSION, 6);
        const files = response.data || [];

        // Filter for NeoForge explicitly just in case
        const neoFiles = files.filter(f => f.gameVersions.includes('NeoForge'));
        latest = neoFiles[0];
      }

      if (!latest) {
        logInfo(`[CurseForge] Nincs megfelelő NeoForge verzió: ${name} (MC ${MC_VERSION})`);
        continue;
      }

      const latestFilename = latest.fileName;
      const dest = path.join(MODS_DIR, latestFilename);

      const existingFiles = fs.readdirSync(MODS_DIR);
      const isPresent = existingFiles.some(f => f === latestFilename);

      if (!isPresent) {
        logInfo(`[CurseForge] Mod letöltése: ${name} -> ${latestFilename}`);
        // Remove old versions of the same mod
        // We look for parts of the name or ID if possible, but name is safer for files
        const searchName = name.toLowerCase().replace(/-/g, '');
        for (const f of existingFiles) {
          const lowerF = f.toLowerCase().replace(/-/g, '');
          if (lowerF.includes(searchName) && f !== latestFilename) {
            logInfo(`[CurseForge] Régi mod verzió törlése: ${f}`);
            fs.unlinkSync(path.join(MODS_DIR, f));
          }
        }

        const downloadUrl = `https://www.curseforge.com/api/v1/mods/${id}/files/${latest.id}/download`;
        await downloadFile(downloadUrl, dest);
      } else {
        logInfo(`[CurseForge] Mod már naprakész: ${name}`);
      }
    } catch (e) {
      logError(`[CurseForge-Hiba] Mod hiba (${name}): ${e.message}`);
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

/**
 * Scans the mods directory and removes duplicate mods.
 * A mod is considered a duplicate if it shares the same base name.
 * If both Fabric and NeoForge versions exist, NeoForge is kept.
 * If multiple versions exist, the most recently modified file is kept.
 */
function cleanupDuplicateMods() {
  if (!fs.existsSync(MODS_DIR)) return;
  
  logInfo('[Installer] Duplikált modok keresése és tisztítása...');
  const files = fs.readdirSync(MODS_DIR).filter(f => f.endsWith('.jar'));
  
  const modGroups = {};
  
  function getBaseName(filename) {
    let name = filename.replace(/\.jar$/i, '');
    name = name.replace(/-(fabric|neoforge|forge)/i, '');
    name = name.replace(/\+.*$/, '');
    const versionMatch = name.match(/-(mc)?v?\d/i);
    if (versionMatch) {
      name = name.substring(0, versionMatch.index);
    }
    return name.toLowerCase().replace(/_/g, '-');
  }

  for (const file of files) {
    const baseName = getBaseName(file);
    if (!modGroups[baseName]) modGroups[baseName] = [];
    modGroups[baseName].push(file);
  }

  let deletedCount = 0;

  for (const [baseName, groupFiles] of Object.entries(modGroups)) {
    if (groupFiles.length > 1) {
      logInfo(`[Installer] Duplikáció észlelve a '${baseName}' modnál: ${groupFiles.join(', ')}`);
      
      // Kikeressük az EXTRA_MODS-ból, hogy ehhez a modhoz milyen loadert preferálunk
      let expectedLoaders = ['neoforge'];
      for (const mod of EXTRA_MODS) {
        const modSlug = mod.slug.toLowerCase().replace(/-/g, '');
        const cleanBase = baseName.replace(/-/g, '');
        if (cleanBase === modSlug) {
          if (mod.loaders) expectedLoaders = mod.loaders;
          break;
        }
      }

      let bestFile = groupFiles[0];
      let bestMatchesExpected = expectedLoaders.some(l => bestFile.toLowerCase().includes(l));
      let bestMtime = fs.statSync(path.join(MODS_DIR, bestFile)).mtimeMs;

      for (let i = 1; i < groupFiles.length; i++) {
        const file = groupFiles[i];
        const matchesExpected = expectedLoaders.some(l => file.toLowerCase().includes(l));
        const mtime = fs.statSync(path.join(MODS_DIR, file)).mtimeMs;
        
        let shouldReplace = false;
        if (matchesExpected && !bestMatchesExpected) {
          shouldReplace = true;
        } else if (matchesExpected === bestMatchesExpected) {
          if (mtime > bestMtime) {
            shouldReplace = true;
          }
        }
        
        if (shouldReplace) {
          bestFile = file;
          bestMatchesExpected = matchesExpected;
          bestMtime = mtime;
        }
      }
      
      for (const file of groupFiles) {
        if (file !== bestFile) {
          logInfo(`[Installer] Törlésre került: ${file} (A megtartott: ${bestFile})`);
          try {
            fs.unlinkSync(path.join(MODS_DIR, file));
            deletedCount++;
          } catch (e) {
            logError(`[Installer] Nem sikerült törölni a duplikált modot: ${file}`);
          }
        }
      }
    }
  }
  
  if (deletedCount > 0) {
    logInfo(`[Installer] Tisztítás befejezve: ${deletedCount} db duplikált mod törölve.`);
  } else {
    logInfo('[Installer] Nem találtam duplikált modokat.');
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

/**
 * Lekéri a legfrissebb NeoForge verziót az MC_VERSION-hez.
 * A maven-metadata.xml-ből szűri az adott MC-verzióhoz illő build-eket.
 * NeoForge verzió formátuma: 21.1.x (1.21.1 -> prefix "21.1.")
 */
async function getLatestNeoForge() {
  const xml = await new Promise((resolve, reject) => {
    https.get(NEOFORGE_MAVEN_META, { headers: { 'User-Agent': 'CobbleServer/1.0' } }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })

  // MC 1.21.1 -> NeoForge prefix: "21.1."
  const mcParts = MC_VERSION.split('.')
  const prefix = `${mcParts[0].replace('1.', '')}.${mcParts[1]}.` // "21.1."
  // Fallback: ha a fenti nem műlik, manuálisan: '21.1.'
  const nfPrefix = MC_VERSION === '1.21.1' ? '21.1.' : prefix

  const matches = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
  const versions = matches.map(m => m[1]).filter(v => v.startsWith(nfPrefix))

  if (versions.length === 0) throw new Error(`Nem található NeoForge verzió MC ${MC_VERSION}-hoz`)

  // A legutolsó (legfrissebb) verzió
  return versions[versions.length - 1]
}

async function verifyIntegrity(state) {
  logInfo('[Installer] Integritás ellenőrzése...')

  // 1. Java check
  const javaExe = getJavaExecutable()
  if (!fs.existsSync(javaExe)) {
    console.warn('[Installer] Java végrehajtható nem található, újratelepítés szükséges.')
    return false
  }

  // 2. NeoForge check
  const nfRunScript = process.platform === 'win32'
    ? path.join(SERVER_DIR, 'run.bat')
    : path.join(SERVER_DIR, 'run.sh')
  if (!fs.existsSync(nfRunScript)) {
    console.warn('[Installer] NeoForge futási szkript nem található, újratelepítés szükséges.')
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
  fs.mkdirSync(CLIENT_MODS_DIR, { recursive: true })

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

    try {
      await downloadFile(file.url, mrpackPath, {
        hash: file.hashes.sha1,
        onProgress: p => {
          process.stdout.write(`\r[Installer] Modpack letöltése: ${Math.round(p * 100)}%`)
        }
      })
      logInfo('\n[Installer] Kicsomagolás (csak overrides/konfig)...')

      const zip = new AdmZip(mrpackPath)

      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue
        const lowerName = entry.entryName.toLowerCase()
        // Mod JAR-okat kihagyjuk (ezeket EXTRA_MODS kezeli NeoForge-on)
        if (lowerName.endsWith('.jar')) continue
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

      // NeoForge portálás: Fabric mod JAR-ok kihagyva, EXTRA_MODS kezeli őket.
      logInfo('[Installer] NeoForge mód: modpack mod JAR-ok kihagyva (EXTRA_MODS kezeli őket).')

      const baseFilenames = []
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

  // 2. NeoForge Server Install
  const nfVersion = await getLatestNeoForge()
  const nfRunScript = process.platform === 'win32'
    ? path.join(SERVER_DIR, 'run.bat')
    : path.join(SERVER_DIR, 'run.sh')

  if (state.neoforgeVersion !== nfVersion || !fs.existsSync(nfRunScript)) {
    logInfo(`[Installer] NeoForge ${nfVersion} telepítése...`)
    const installerJar = path.join(SERVER_DIR, `neoforge-${nfVersion}-installer.jar`)
    const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${nfVersion}/neoforge-${nfVersion}-installer.jar`
    await downloadFile(installerUrl, installerJar)

    await new Promise((resolve, reject) => {
      execFile(
        javaPath,
        ['-jar', installerJar, '--install-server', SERVER_DIR],
        { cwd: SERVER_DIR },
        (err, stdout, stderr) => {
          if (err && !fs.existsSync(nfRunScript)) {
            reject(new Error('NeoForge server telepítés hiba: ' + (stderr || err.message)))
          } else {
            resolve()
          }
        }
      )
    })

    if (fs.existsSync(installerJar)) fs.unlinkSync(installerJar)

    // run.sh futési jog beállítása Linuxon
    if (process.platform !== 'win32' && fs.existsSync(nfRunScript)) {
      fs.chmodSync(nfRunScript, 0o755)
    }

    state.neoforgeVersion = nfVersion
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
    logInfo(`[Installer] NeoForge ${nfVersion} telepítése sikeres.`)
  } else {
    logInfo(`[Installer] NeoForge (${nfVersion}) már telepítve.`)
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
      'view-distance=6',
      'simulation-distance=5',
      'sync-chunk-writes=false',
      'entity-broadcast-range-percentage=75',
      'network-compression-threshold=256'
    ].join('\n') + '\n')
    logInfo('[Installer] server.properties létrehozva (online-mode=false, entity-broadcast 75%, compression 256).')
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

    if (/^view-distance\s*=\s*(?!6$).*/m.test(props)) {
      props = props.replace(/^view-distance\s*=.*/m, 'view-distance=6')
      modified = true
    } else if (!/^view-distance\s*=/m.test(props)) {
      props = props.trimEnd() + '\nview-distance=6\n'
      modified = true
    }

    if (/^simulation-distance\s*=\s*(?!5$).*/m.test(props)) {
      props = props.replace(/^simulation-distance\s*=.*/m, 'simulation-distance=5')
      modified = true
    } else if (!/^simulation-distance\s*=/m.test(props)) {
      props = props.trimEnd() + '\nsimulation-distance=5\n'
      modified = true
    }

    if (/^sync-chunk-writes\s*=\s*(?!false$).*/m.test(props)) {
      props = props.replace(/^sync-chunk-writes\s*=.*/m, 'sync-chunk-writes=false')
      modified = true
    } else if (!/^sync-chunk-writes\s*=/m.test(props)) {
      props = props.trimEnd() + '\nsync-chunk-writes=false\n'
      modified = true
    }

    // entity-broadcast-range-percentage=75 → csak a 75%-os sugarú entitásokat küldi a kliensnek
    // Cobblemon-nál ez a leggyorsabb módja az entity sync overhead csökkentésének.
    if (/^entity-broadcast-range-percentage\s*=\s*(?!75$).*/m.test(props)) {
      props = props.replace(/^entity-broadcast-range-percentage\s*=.*/m, 'entity-broadcast-range-percentage=75')
      modified = true
    } else if (!/^entity-broadcast-range-percentage\s*=/m.test(props)) {
      props = props.trimEnd() + '\nentity-broadcast-range-percentage=75\n'
      modified = true
    }

    // network-compression-threshold=256 → kisebb csomagoknál nem tömörít → kevesebb CPU
    if (/^network-compression-threshold\s*=\s*(?!256$).*/m.test(props)) {
      props = props.replace(/^network-compression-threshold\s*=.*/m, 'network-compression-threshold=256')
      modified = true
    } else if (!/^network-compression-threshold\s*=/m.test(props)) {
      props = props.trimEnd() + '\nnetwork-compression-threshold=256\n'
      modified = true
    }

    if (modified) {
      fs.writeFileSync(serverPropsPath, props)
      logInfo('[Installer] server.properties frissítve (entity-broadcast 75%, compression 256, view/sim distance).')
    } else {
      logInfo('[Installer] server.properties megfelelő, nincs teendő.')
    }
  }

  // 4. Extra Mods (Chipped, TerraBlender)
  await ensureExtraMods()

  // 6. Blacklist Cleanup (Ensure unwanted mods are gone)
  await cleanupBlacklistedMods()

  // 6b. Extra Datapacks (CurseForge)
  await ensureExtraDatapacks()

  // 6c. Extra Mods (CurseForge)
  await ensureCurseForgeMods()

  // 6d. Custom Direct Downloads (GitHub etc.)
  for (const mod of CUSTOM_DIRECT_MODS) {
    const dest = path.join(MODS_DIR, mod.name);
    if (!fs.existsSync(dest)) {
      logInfo(`[DirectDL] Mod letöltése: ${mod.name}...`);
      await downloadFile(mod.url, dest);
    }
  }

  // 7. Modrinth Mod Updates
  await updateModsFromModrinth()

  // 8. Cleanup Duplicate Mods
  cleanupDuplicateMods()

  // Regenerate .modpack-files.json from the actual current mods folder.
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
