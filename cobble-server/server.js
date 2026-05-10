/**
 * CobbleServer – Mod Sync Server
 * ─────────────────────────────────────────────────────────────
 * Elindítás:  node server.js        (alapból 7878-as porton)
 *             PORT=9000 node server.js
 *
 * Mod hozzáadás/törlés: a mods/ mappában egyszerűen másold / töröld a .jar fájlokat.
 * A kliens a következő szinkronizáláskor automatikusan észleli a változást.
 *
 * Végpontok:
 *   GET /            – állapot info
 *   GET /manifest    – mod lista SHA256 hashekkel (JSON)
 *   GET /mods/:file  – mod fájl letöltése
 * ─────────────────────────────────────────────────────────────
 */

'use strict'
// Optimalizáljuk a Node.js beépített C++ thread pool-ját a CPU magok számához (min 4).
// Ez gyorsítja a bejelentkezés jelszó-hashelését és az aszinkron fájlműveleteket.
process.env.UV_THREADPOOL_SIZE = Math.max(4, require('os').cpus().length).toString()

const http = require('http')
const fs = require('fs')
const path = require('path')
const mysql = require('mysql2/promise')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const os = require('os')
const { spawn, execFile } = require('child_process')
const { install, downloadFile, rollback, commitUpdate, logInfo, logError } = require('./installer')
const https = require('https')
const { Worker } = require('worker_threads')
const EventEmitter = require('events')
const serverEvents = new EventEmitter()

// ── Hardcoded Configuration ──────────────────────────────────
const dbConfig = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: '123456',
  database: 'cobble_universe'
}

const PORT = 8080
const LAUNCHER_SECRET = 'cobble-super-secret-key-2024'

const DATA_DIR = path.join(__dirname, 'server-data')

// ── SkinRestorer Auto-Config ─────────────────────────────────
function configureSkinRestorer() {
  const srDir = path.join(DATA_DIR, 'config', 'skinrestorer')
  const srConfigPath = path.join(srDir, 'config.json')
  
  if (!fs.existsSync(srDir)) {
    fs.mkdirSync(srDir, { recursive: true })
  }

  if (fs.existsSync(srConfigPath)) {
    try {
      let content = fs.readFileSync(srConfigPath, 'utf8')
      let json = JSON.parse(content)
      let modified = false
      
      if (json.join) {
        if (json.join.refreshSkin !== false) {
          json.join.refreshSkin = false
          modified = true
        }
        if (json.join.autoFetch && json.join.autoFetch.enabled !== false) {
          json.join.autoFetch.enabled = false
          modified = true
        }
      }

      if (json.providers) {
        if (json.providers.mojang && json.providers.mojang.enabled !== false) {
          json.providers.mojang.enabled = false
          modified = true
        }
        if (json.providers.ely_by && json.providers.ely_by.enabled !== false) {
          json.providers.ely_by.enabled = false
          modified = true
        }
      }

      
      if (modified) {
        fs.writeFileSync(srConfigPath, JSON.stringify(json, null, 2), 'utf8')
        console.log('[SkinRestorer] config.json beállítások frissítve.')
      }
    } catch (e) {
      console.error('[SkinRestorer] Hiba a konfiguráció frissítésekor:', e.message)
    }
  } else {
    // Default settings with the requested modifications
    const defaultSettings = {
      "language": "en_us",
      "join": {
        "refreshSkin": false,
        "skipRefreshProviders": [],
        "applyDelay": 0,
        "autoFetch": {
          "enabled": false,
          "overrideExisting": false,
          "provider": "mojang"
        }
      },
      "request": {
        "proxy": "",
        "timeout": 10,
        "userAgent": ""
      },
      "providers": {
        "mojang": { "enabled": false, "name": "mojang", "cache": { "enabled": true, "duration": 60 } },
        "ely_by": { "enabled": false, "name": "ely.by", "cache": { "enabled": true, "duration": 60 } },
        "mineskin": { "apiKey": "", "proxyUrlUpload": false, "enabled": true, "name": "web", "cache": { "enabled": true, "duration": 300 } },
        "collection": { "sources": [], "enabled": false, "name": "collection", "cache": { "enabled": true, "duration": 604800 } },
        "custom": []
      },
      "version": 2
    }
    try {
      fs.writeFileSync(srConfigPath, JSON.stringify(defaultSettings, null, 2), 'utf8')
      console.log('[SkinRestorer] config.json létrehozva és konfigurálva.')
    } catch (e) {
      console.error('[SkinRestorer] Hiba a konfiguráció létrehozásakor:', e.message)
    }
  }
}


// ── EasyAuth Auto-Config ─────────────────────────────────────
function configureEasyAuth() {
  const easyAuthDir = path.join(DATA_DIR, 'config', 'EasyAuth')
  const easyAuthPath = path.join(easyAuthDir, 'storage.conf')
  
  // Mappa létrehozása ha nincs
  if (!fs.existsSync(easyAuthDir)) {
    fs.mkdirSync(easyAuthDir, { recursive: true })
  }

  if (!fs.existsSync(easyAuthPath)) {
    // Ha nem létezik, létrehozzuk az alap sablont a mi adatainkkal
    const template = `# EasyAuth Storage Configuration
database-type=mysql

mysql {
    mysql-host=${dbConfig.host}
    mysql-user=${dbConfig.user}
    mysql-password="${dbConfig.password}"
    mysql-database=${dbConfig.database}
    mysql-table=easyauth
}
`
    try {
      fs.writeFileSync(easyAuthPath, template, 'utf8')
      console.log('[EasyAuth] storage.conf létrehozva és konfigurálva.')
    } catch (e) {
      console.error('[EasyAuth] Nem sikerült létrehozni a konfigurációt:', e.message)
    }
  } else {
    // Ha létezik, csak frissítjük az értékeket
    try {
      let content = fs.readFileSync(easyAuthPath, 'utf8')
      if (!content.includes('database-type=sqlite')) {
        content = content.replace(/database-type=.*/, 'database-type=mysql')
      }
      content = content.replace(/mysql-host=.*/, `mysql-host=${dbConfig.host}`)
      content = content.replace(/mysql-user=.*/, `mysql-user=${dbConfig.user}`)
      content = content.replace(/mysql-password=.*/, `mysql-password="${dbConfig.password}"`)
      content = content.replace(/mysql-database=.*/, `mysql-database=${dbConfig.database}`)
      content = content.replace(/mysql-table=.*/, 'mysql-table=easyauth')
      fs.writeFileSync(easyAuthPath, content, 'utf8')
      console.log('[EasyAuth] storage.conf frissítve.')
    } catch (e) {
      console.error('[EasyAuth] Hiba a frissítés során:', e.message)
    }
  }
}


// ── Creeper Firework Auto-Config ─────────────────────────────

// ── ServerCore Auto-Config ───────────────────────────────────
/**
 * ServerCore telepítve van, de config nélkül alapértelmezetten fut.
 * Ez a függvény optimált beállításokat ír ki indításkor:
 *  - entity tick throttling (a legtöbb lag-spike forrása Cobblemon szervereken)
 *  - chunk load limit (megakadályozza a hirtelen chunk-burst-öket)
 *  - max entity cap per chunk
 */
function configureServerCore() {
  const scDir  = path.join(DATA_DIR, 'config', 'servercore')
  const scPath = path.join(scDir, 'config.toml')

  if (!fs.existsSync(scDir)) fs.mkdirSync(scDir, { recursive: true })

  // Mindig felülírjuk, hogy a kód legyen az igazság forrása
  const config = `# ServerCore – auto-generált konfig (cobble-server/server.js)
# Részletes dokumentáció: https://modrinth.com/mod/servercore

[optimizations]
  # Throttle entities that haven't been near a player for a while.
  # Ez az egyetlen legnagyobb hatású beállítás Cobblemon modpackokon.
  enable_entity_slowdown = true

  # Milliseconds per tick budget for inactive entities.
  # 60ms = inaktív Pokémon max 1 tick/60ms → drasztikusan csökkenti a Pokémon AI overhead-et.
  inactive_entity_slowdown = 60

  # Aggressively limit the number of entities loaded per chunk.
  enable_entity_cramming = false

[chunk_loading]
  # Max chunks loaded per tick by a single player during exploration.
  # RUBBER BANDING FIX: 6 → 32. PokeBike és más gyors járművek lónál 2-3x gyorsabbak,
  # ezért 20 is kevés lehet. 32 fedezi a gyors járműveket is rubber band nélkül.
  max_chunk_loads_per_tick = 32

  # true = CPU megtakarítás: játékosoktól messze lévő chunkok nem tickelnek.
  # Ez NEM okoz rubber bandingot – a visszadobás oka a GC szünet volt, nem ez.
  disable_unloaded_chunk_simulation = true

[entity_limits]
  # Global entity cap per chunk (minden entity típusra összesen).
  # 60 = konzervatív felső határ, Cobblemon hajlamos 150+ entitást gyűjteni chunk-onként.
  global_cap = 60

  # Mob-specifikus korlátok
  # FONTOS: cobblemon:pokemon a legnagyobb TPS-tolvaj – 20/chunk már bőven elég.
  [entity_limits.limits]
    "cobblemon:pokemon" = 20
    "cobblemon:empty_pokeball" = 5
    "minecraft:bat" = 2
    "minecraft:cod" = 6
    "minecraft:salmon" = 6
    "minecraft:tropical_fish" = 6
    "minecraft:squid" = 4
    "minecraft:glow_squid" = 4
`

  try {
    fs.writeFileSync(scPath, config, 'utf8')
    console.log('[ServerCore] config.toml kiírva.')
  } catch (e) {
    console.error('[ServerCore] Hiba a konfiguráció írása közben:', e.message)
  }
}


// ── Cobblemon Excitement Auto-Config ──────────────────────────
function configureCobblemonExcitement() {
  const mainPath = path.join(DATA_DIR, 'config', 'cobblemon', 'main.json')
  const fofPath = path.join(DATA_DIR, 'config', 'fightorflight.json5')
  const fofMovesPath = path.join(DATA_DIR, 'config', 'fightorflight_moves.json5')

  // 1. Cobblemon Main Config
  if (fs.existsSync(mainPath)) {
    try {
      let content = fs.readFileSync(mainPath, 'utf8')
      let json = JSON.parse(content)
      if (json.playerDamagePokemon !== true) {
        json.playerDamagePokemon = true
        fs.writeFileSync(mainPath, JSON.stringify(json, null, 2), 'utf8')
        console.log('[Cobblemon] playerDamagePokemon engedélyezve.')
      }
    } catch (e) { console.error('[Cobblemon] Hiba a main.json frissítésekor:', e.message) }
  }

  // 2. Fight or Flight Config (Regex used for JSON5)
  if (fs.existsSync(fofPath)) {
    try {
      let content = fs.readFileSync(fofPath, 'utf8')
      let modified = false
      if (content.match(/"light_dependent_unprovoked_attack"\s*:\s*true/)) {
        content = content.replace(/"light_dependent_unprovoked_attack"\s*:\s*true/g, '"light_dependent_unprovoked_attack": false')
        modified = true
      }
      if (content.match(/"aggressive_threshold"\s*:\s*100\.0/)) {
        content = content.replace(/"aggressive_threshold"\s*:\s*100\.0/g, '"aggressive_threshold": 60.0')
        modified = true
      }
      if (modified) {
        fs.writeFileSync(fofPath, content, 'utf8')
        console.log('[FightOrFlight] Agresszió beállítások frissítve.')
      }
    } catch (e) { console.error('[FightOrFlight] Hiba a fightorflight.json5 frissítésekor:', e.message) }
  }

  // 3. Fight or Flight Moves Config
  if (fs.existsSync(fofMovesPath)) {
    try {
      let content = fs.readFileSync(fofMovesPath, 'utf8')
      let modified = false
      if (content.match(/"wild_pokemon_taunt"\s*:\s*false/)) {
        content = content.replace(/"wild_pokemon_taunt"\s*:\s*false/g, '"wild_pokemon_taunt": true')
        modified = true
      }
      if (content.match(/"pokemon_griefing"\s*:\s*false/)) {
        content = content.replace(/"pokemon_griefing"\s*:\s*false/g, '"pokemon_griefing": true')
        modified = true
      }
      if (content.match(/"should_create_fire"\s*:\s*false/)) {
        content = content.replace(/"should_create_fire"\s*:\s*false/g, '"should_create_fire": true')
        modified = true
      }
      if (modified) {
        fs.writeFileSync(fofMovesPath, content, 'utf8')
        console.log('[FightOrFlight] Mozgás és rombolás beállítások frissítve.')
      }
    } catch (e) { console.error('[FightOrFlight] Hiba a fightorflight_moves.json5 frissítésekor:', e.message) }
  }
}

let pool = null

// ── server.properties Auto-Config ──────────────────────────
/**
 * Beállítja a kritikus server.properties értékeket:
 *  - simulation-distance: csökkenti a Pokémon AI terhelését messze lévő chunkokban
 *  - network-compression-threshold: csökkenti a tömörítési overhead-et helyi hálón
 *  - view-distance: optimalizált látótávolság
 */
function configureServerProperties() {
  const propsPath = path.join(DATA_DIR, 'server.properties')
  if (!fs.existsSync(propsPath)) {
    console.log('[server.properties] Fájl nem létezik még, szerver első indításkor hozza létre. Kihagyás.')
    return
  }

  const PROPS_TO_SET = {
    // Szimuláció távolság: a szerver ennyi chunkban futtatja a játéklogikát (entity AI, növény növekedés, stb.).
    // 6 = ~96 blokk. Csökkenti a Cobblemon Pokémon AI overhead-et messze lévő chunkokban.
    // Hatás: kevesebb TPS-tolvaj entitás → egyenletesebb tick → kevesebb rubber band.
    'simulation-distance': '6',
    // Látótávolság: a kliens ennyi chunkot lát vizuálisan (nem kell szimulálni mind).
    // 10 = jó kompromisszum teljesítmény és élmény között.
    'view-distance': '10',
    // Hálózati tömörítési küszöb bájtban. 256 = minden packetet tömörít.
    // Internet-en ez JOBB: csökkenti a sávszélességet és a ping-et távolról csatlakozó játékosoknál.
    'network-compression-threshold': '256',
    // Online mód kikapcsolva marad (saját auth van EasyAuth-on keresztül)
    'online-mode': 'false',
  }

  try {
    let content = fs.readFileSync(propsPath, 'utf8')
    let modified = false

    for (const [key, value] of Object.entries(PROPS_TO_SET)) {
      const regex = new RegExp(`^${key}=.*`, 'm')
      if (regex.test(content)) {
        const currentVal = content.match(regex)[0].split('=')[1]
        if (currentVal !== value) {
          content = content.replace(regex, `${key}=${value}`)
          modified = true
          console.log(`[server.properties] ${key}: ${currentVal} → ${value}`)
        }
      } else {
        content += `\n${key}=${value}`
        modified = true
        console.log(`[server.properties] ${key}=${value} hozzáadva`)
      }
    }

    if (modified) {
      fs.writeFileSync(propsPath, content, 'utf8')
      console.log('[server.properties] Frissítve.')
    } else {
      console.log('[server.properties] Minden beállítás naprakész.')
    }
  } catch (e) {
    console.error('[server.properties] Hiba:', e.message)
  }
}

async function initDatabase() {
  configureEasyAuth()
  configureSkinRestorer()
  configureCobblemonExcitement()
  configureServerCore()
  configureServerProperties()
  
  try {
    // Első csatlakozás adatbázis nélkül, hogy létrehozzuk ha nincs
    const connection = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password
    })
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`)
    await connection.end()

    // Most már csatlakozhatunk a konkrét adatbázishoz
    pool = mysql.createPool(dbConfig)
    
    const tableQuery = `
      CREATE TABLE IF NOT EXISTS leaderboard (
        uuid VARCHAR(36) PRIMARY KEY,
        username VARCHAR(100),
        playtime DOUBLE DEFAULT 0,
        caught INT DEFAULT 0,
        pokedex INT DEFAULT 0,
        shiny INT DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `
    const playersTableQuery = `
      CREATE TABLE IF NOT EXISTS players (
        id INT AUTO_INCREMENT PRIMARY KEY,
        hwid VARCHAR(64),
        profile_id VARCHAR(64),
        username VARCHAR(100),
        uuid VARCHAR(36) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY hwid_profile (hwid, profile_id)
      )
    `
    const usersTableQuery = `
      CREATE TABLE IF NOT EXISTS easyauth (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE,
        username_lower VARCHAR(255),
        uuid VARCHAR(255),
        data LONGTEXT,
        last_ip VARCHAR(45)
      )
    `
    const rewardsTableQuery = `
      CREATE TABLE IF NOT EXISTS daily_rewards (
        username VARCHAR(100) PRIMARY KEY,
        last_claim TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    const campaignTableQuery = `
      CREATE TABLE IF NOT EXISTS campaign_progress (
        username VARCHAR(100) PRIMARY KEY,
        defeated_ids JSON DEFAULT '[]',
        claimed_ids  JSON DEFAULT '[]',
        started_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `
    await pool.query(tableQuery)
    await pool.query(playersTableQuery)
    await pool.query(usersTableQuery)
    await pool.query(rewardsTableQuery)
    await pool.query(campaignTableQuery)

    // Migrate campaign_progress: add claimed_ids if old schema (defeated_count column)
    try {
      await pool.query('ALTER TABLE campaign_progress ADD COLUMN claimed_ids JSON DEFAULT \'[]\'')
      console.log('[Campaign] claimed_ids oszlop hozzáadva a campaign_progress táblához.')
    } catch (_) { /* már létezik */ }
    try {
      await pool.query('ALTER TABLE campaign_progress DROP COLUMN defeated_count')
    } catch (_) { /* nem létezik */ }


    // Ha a tábla korábban jött létre a data oszlop nélkül, ezzel hozzáadjuk
    try {
      await pool.query('ALTER TABLE easyauth ADD COLUMN data LONGTEXT')
    } catch (e) {
      // Ignoráljuk
    }

    // Visszaállítjuk a helyes Offline UUID-kat az adatbázisban, ha korábban elrontottuk volna
    try {
      const [rows] = await pool.query('SELECT username FROM easyauth WHERE uuid NOT LIKE "%-%"')
      for (const row of rows) {
        const uname = row.username
        const hash = crypto.createHash('md5').update('OfflinePlayer:' + uname).digest()
        hash[6] = (hash[6] & 0x0f) | 0x30
        hash[8] = (hash[8] & 0x3f) | 0x80
        const hex = hash.toString('hex')
        const realUuid = [hex.substring(0, 8), hex.substring(8, 12), hex.substring(12, 16), hex.substring(16, 20), hex.substring(20)].join('-')
        await pool.query('UPDATE easyauth SET uuid = ? WHERE username = ?', [realUuid, uname])
      }
    } catch (e) {
      // Ignoráljuk
    }

    // Biztosítjuk, hogy a username_lower oszlop is ki legyen töltve (az EasyAuth ezt használja keresésre!)
    try {
      await pool.query('UPDATE easyauth SET username_lower = LOWER(username) WHERE username_lower IS NULL OR username_lower = ""')
    } catch (e) {
      // Ignoráljuk
    }

    console.log('[MariaDB] Adatbázis és táblák inicializálva.')
    
    // Első szinkronizálás
    syncLeaderboardFromFiles()
  } catch (e) {
    console.error('[MariaDB] Hiba az inicializáláskor:', e.message)
  }
}


// initDatabase() removed from global scope to be awaited in start()
const SKINS_DIR = path.join(DATA_DIR, 'skins')
const SYNC_FOLDERS = ['mods', 'datapacks', 'config', 'resourcepacks', 'shaderpacks']

// Map of folder names to their full paths
const DIRS = {}
SYNC_FOLDERS.forEach(f => {
  DIRS[f] = path.join(DATA_DIR, f)
})

// Convenience constant for the mods folder used in several handlers
const MODS_DIR = DIRS['mods']

const PUBLIC_DIR = path.join(__dirname, 'public')
const WEB_INSTALLER_DIR = path.join(__dirname, '..', 'web-installer')
const DIST_DIR = path.join(__dirname, '..', 'dist')

let mcProcess = null
let mcStatus = 'stopped'
let activeJavaPath = null
let nextRestartTime = null
let isServerReady = false
const UPDATE_FAILED_FLAG = path.join(DATA_DIR, '.update-failed')

// Játékosok nyomon követése
const onlinePlayers = new Set()
const verifiedLaunchers = new Map() // username -> { ip, expiry }

// ── Pokémon of the Day Showcase ───────────────────────────────
// Load full pokemon list (1025)
let showcasePokemons = []
try {
  const listPath = path.join(__dirname, 'pokemon_list.txt')
  if (fs.existsSync(listPath)) {
    const lines = fs.readFileSync(listPath, 'utf8').split('\n').map(s => s.trim()).filter(s => s)
    showcasePokemons = lines.map(id => ({
      id: id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      sprite: id,
      descKey: `showcase.desc_${id}`
    }))
    console.log(`[Showcase] Loaded ${showcasePokemons.length} Pokémon for daily rotation.`)
  } else {
    // Fallback if list missing
    showcasePokemons = [
      { id: "charizard", name: "Charizard", sprite: "charizard", descKey: "showcase.desc_charizard" },
      { id: "rayquaza", name: "Rayquaza", sprite: "rayquaza", descKey: "showcase.desc_rayquaza" }
    ]
  }
} catch (e) {
  console.error('[Showcase] Error loading pokemon list:', e.message)
}

let currentShowcase = null

// Fájl ahova a napi showcase-t mentjük (perzisztencia szerver-restart esetén)
const SHOWCASE_FILE = path.join(DATA_DIR, '.daily-showcase.json')

/**
 * Visszaadja az aktuális nap string-jét (pl. "2026-05-05") UTC alapján.
 * Ez a seed a determinisztikus napi választáshoz.
 */
function getTodayDateString() {
  return new Date().toISOString().slice(0, 10) // "YYYY-MM-DD"
}

/**
 * Determinisztikus index-kiválasztás a lista hosszából és a dátum-seed alapján.
 * Azonos napon mindig ugyanazt az indexet adja vissza.
 */
function getDailyIndex(listLength, dateStr) {
  // Egyszerű hash: a dátum karakterkódjai összeadva mod listaméret
  let hash = 0
  for (let i = 0; i < dateStr.length; i++) {
    hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0
  }
  return hash % listLength
}

function boostSpawnRate(pokemonId) {
  try {
    const dpDir = path.join(DATA_DIR, 'datapacks', 'daily_boost')
    const spawnDir = path.join(dpDir, 'data', 'cobblemon', 'spawn_pool_world')
    
    // Cleanup old location if it exists (moved from world/datapacks to datapacks)
    const oldDpDir = path.join(DATA_DIR, 'world', 'datapacks', 'daily_boost')
    if (fs.existsSync(oldDpDir)) {
      fs.rmSync(oldDpDir, { recursive: true, force: true })
    }

    // Remove old boost if exists in new location
    if (fs.existsSync(dpDir)) {
      fs.rmSync(dpDir, { recursive: true, force: true })
    }
    
    // Create new boost datapack
    fs.mkdirSync(spawnDir, { recursive: true })
    
    // pack.mcmeta
    const mcmeta = {
      pack: {
        pack_format: 15,
        description: `Daily Boost for ${pokemonId}`
      }
    }
    fs.writeFileSync(path.join(dpDir, 'pack.mcmeta'), JSON.stringify(mcmeta, null, 2))
    
    // Spawn rule
    const spawnRule = {
      "enabled": true,
      "steps": [
        {
          "id": `boost_${pokemonId}`,
          "pokemon": `nbt:{"name": "cobblemon:${pokemonId}"}`,
          "bucket": "common",
          "weight": 10.0,
          "condition": {
            "canSpawnPokemon": true
          }
        }
      ]
    }
    fs.writeFileSync(path.join(spawnDir, `${pokemonId}.json`), JSON.stringify(spawnRule, null, 2))
    
    // Manifest érvénytelenítése, hogy a kliensek szinkronizálják az új datapacket
    invalidateManifest()
    console.log(`[Showcase] Spawn boost applied for ${pokemonId} via datapack.`)
  } catch (e) {
    console.error(`[Showcase] Failed to apply spawn boost: ${e.message}`)
  }
}

async function updateShowcase() {
  if (showcasePokemons.length === 0) return

  const today = getTodayDateString()

  // 1. Ha már van mentett showcase és az mai napra szól, töltjük be azt
  try {
    if (fs.existsSync(SHOWCASE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SHOWCASE_FILE, 'utf8'))
      if (saved.date === today && saved.pokemon) {
        currentShowcase = saved.pokemon
        console.log(`[Showcase] Mai Pokémon betöltve mentett állapotból: ${currentShowcase.name} (${today})`)
        // Datapack szinkronban van-e? Ha nem, regeneráljuk (pl. mappa törölték)
        const dpDir = path.join(DATA_DIR, 'datapacks', 'daily_boost')
        if (!fs.existsSync(dpDir)) {
          console.log(`[Showcase] Datapack hiányzik, újragenerálás: ${currentShowcase.id}`)
          boostSpawnRate(currentShowcase.id)
        }
        return
      }
    }
  } catch (e) {
    console.warn(`[Showcase] Mentett showcase betöltési hiba, újragenerálás: ${e.message}`)
  }

  // 2. Új nap (vagy nincs mentett állapot) – determinisztikus választás dátum alapján
  const index = getDailyIndex(showcasePokemons.length, today)
  currentShowcase = { ...showcasePokemons[index] }
  console.log(`[Showcase] Új napi Pokémon (${today}): ${currentShowcase.name} (index: ${index})`)

  // 3. Dinamikus leírás lekérése (PokeAPI)
  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${currentShowcase.id}`)
    if (res.ok) {
      const data = await res.json()
      const entry = data.flavor_text_entries.find(e => e.language.name === 'en')
      if (entry) {
        currentShowcase.apiDesc = entry.flavor_text.replace(/[\f\n\r]/g, ' ')
        console.log(`[Showcase] Leírás lekérve: ${currentShowcase.name}`)
      }
    }
  } catch (e) {
    console.warn(`[Showcase] Nem sikerült lekérni a leírást: ${e.message}`)
  }

  // 4. Mentés lemezre (perzisztencia)
  try {
    fs.writeFileSync(SHOWCASE_FILE, JSON.stringify({ date: today, pokemon: currentShowcase }, null, 2))
    console.log(`[Showcase] Napi showcase mentve: ${SHOWCASE_FILE}`)
  } catch (e) {
    console.error(`[Showcase] Mentési hiba: ${e.message}`)
  }

  // 5. Datapack generálása a boosthoz
  boostSpawnRate(currentShowcase.id)
}
// Az updateShowcase() hívását kivesszük innen, és betesszük a start() folyamatba

// ── Whitelist & Server Status ──────────────────────────────────────────

// Ensure sync directories exist
SYNC_FOLDERS.forEach(f => {
  fs.mkdirSync(DIRS[f], { recursive: true })
})
fs.mkdirSync(SKINS_DIR, { recursive: true })
console.log(`[Skins-Init] Absolute skins directory: ${path.resolve(SKINS_DIR)}`)

// ── Auth ──────────────────────────────────────────────────────────
const AUTH_FILE = path.join(DATA_DIR, '.admin-auth.json')
const authTokens = new Map() // token → expiry ms
const pbkdf2 = require('util').promisify(crypto.pbkdf2)

// In-memory auth cache – elkerüli az fs.readFileSync-et minden admin kérésnél
let _cachedAuth = undefined

function loadAuth() {
  if (_cachedAuth !== undefined) return _cachedAuth
  try { _cachedAuth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')) } catch { _cachedAuth = null }
  return _cachedAuth
}
function saveAuth(data) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data))
  _cachedAuth = data // cache frissítése
}

// Async pbkdf2 – a *Sync változat 100k iterációval ~200ms-ig blokkolta a főszálat!
async function hashPassword(password) {
  const salt = crypto.randomBytes(32).toString('hex')
  const buf = await pbkdf2(password, salt, 100000, 64, 'sha512')
  return { salt, hash: buf.toString('hex') }
}
async function verifyPassword(password, salt, storedHash) {
  try {
    const buf = await pbkdf2(password, salt, 100000, 64, 'sha512')
    const h = buf.toString('hex')
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(storedHash, 'hex'))
  } catch { return false }
}

/**
 * Generates a deterministic Minecraft offline-mode UUID for a given username.
 */
function getOfflineUUID(username) {
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + username).digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return [hex.substring(0, 8), hex.substring(8, 12), hex.substring(12, 16), hex.substring(16, 20), hex.substring(20)].join('-')
}
function generateToken() {
  return crypto.randomBytes(32).toString('hex')
}
function checkAuth(req, res) {
  const auth = loadAuth()
  if (!auth) return true
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim()
  const expiry = authTokens.get(token)
  if (!expiry || Date.now() > expiry) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Nincs bejelentkezve.' }))
    return false
  }
  authTokens.set(token, Date.now() + 24 * 3600 * 1000)
  return true
}
// Lejárt tokenek törlése
setInterval(() => {
  const now = Date.now()
  for (const [t, exp] of authTokens) if (now > exp) authTokens.delete(t)
}, 60000)

// ── Minecraft Process Management ─────────────────────────────

function startMinecraft() {
  if (mcStatus === 'running' || !activeJavaPath) return
  console.log('[Minecraft] Szerver indítása (java -jar fabric-server-launch.jar nogui)...')
  
  // ── Oracle GraalVM 21 JVM argumentumok ───────────────────────
  // Forrás: https://github.com/brucethemoose/Minecraft-Performance-Flags-Benchmarks
  // A GraalVM agresszívabb JIT fordítója ~20%+ gyorsabb chunk-generálást ad.
  //
  // FONTOS: GraalVM-mel CSAK G1GC használható (ZGC/Shenandoah nem kompatibilis).
  // Az -Dgraal.CompilerConfiguration=enterprise és TuneInlinerExploration
  // az Oracle GraalVM (volt EE) exkluzív optimalizátorát kapcsolja be.
  const serverJvmArgs = [
    '-Xmx8G',
    '-Xms8G',
    // ── GraalVM-specifikus JIT optimalizáció ──
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+UnlockDiagnosticVMOptions',
    '-XX:+AlwaysActAsServerClassMachine',
    '-XX:+AlwaysPreTouch',
    '-XX:+DisableExplicitGC',
    '-XX:+UseNUMA',
    '-XX:AllocatePrefetchStyle=3',
    '-XX:NmethodSweepActivity=1',
    '-XX:ReservedCodeCacheSize=400M',
    '-XX:NonNMethodCodeHeapSize=12M',
    '-XX:ProfiledCodeHeapSize=194M',
    '-XX:NonProfiledCodeHeapSize=194M',
    '-XX:-DontCompileHugeMethods',
    '-XX:+PerfDisableSharedMem',
    '-XX:+UseFastUnorderedTimeStamps',
    '-XX:+UseCriticalJavaThreadPriority',
    '-XX:+EagerJVMCI',               // GraalVM JIT azonnali aktiválása
    '-Dgraal.TuneInlinerExploration=1', // Agresszív method inlining
    '-Dgraal.CompilerConfiguration=enterprise', // Oracle EE compiler konfig
    // ── G1GC (kötelező GraalVM-mel) ──────────
    '-XX:+UseG1GC',
    '-XX:MaxGCPauseMillis=37',         // RUBBER BAND FIX: 80→37ms. 1 tick = 50ms, tehát 80ms
                                       // szünet = 1.6 tick kiesés → szerver visszadobja a játékost.
                                       // 37ms < 50ms (1 tick), így GC befér egy tick résbe.
    '-XX:G1HeapRegionSize=16M',
    '-XX:G1NewSizePercent=28',
    '-XX:G1ReservePercent=20',
    '-XX:G1MixedGCCountTarget=3',
    '-XX:InitiatingHeapOccupancyPercent=20', // 15→20%: ritkábban triggerel GC → kevesebb szünet
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=0',
    '-XX:SurvivorRatio=32',
    '-XX:MaxTenuringThreshold=1',
    '-XX:G1SATBBufferEnqueueingThresholdPercent=30',
    '-XX:G1ConcMarkStepDurationMillis=5',
    '-XX:G1ConcRSHotCardLimit=16',
    '-XX:G1ConcRefinementServiceIntervalMillis=150',
    '-jar', 'fabric-server-launch.jar',
    'nogui'
  ]
  mcProcess = spawn(activeJavaPath, serverJvmArgs, {
    cwd: DATA_DIR,
    stdio: ['pipe', 'pipe', 'inherit'] // stdout 'pipe', hogy tudjuk olvasni a játékos csatlakozásokat
  })
  mcStatus = 'running'
  isServerReady = false

  // Előre fordított regex-ek – egyszer fordulnak le, nem minden data event-nél
  const RE_DONE  = /Done \(.*s\)! For help, type "help"/
  const RE_JOIN  = /:\s+([a-zA-Z0-9_]{3,16})\s+joined the game/
  const RE_LEAVE = /:\s+([a-zA-Z0-9_]{3,16})\s+left the game/
  const RE_CAMPAIGN = /\[CAMPAIGN_DEFEAT\]\s+([a-zA-Z0-9_]{3,16})\s+([a-zA-Z0-9_]+)/

  // Segédfüggvény a győzelem adatbázisba mentéséhez
  const triggerCampaignDefeat = (pName, stageId) => {
    console.log(`[Campaign] Játékbeli győzelem észlelve: ${pName} legyőzte: ${stageId}`)
    if (pool) {
      pool.query('SELECT defeated_ids FROM campaign_progress WHERE username = ?', [pName]).then(([rows]) => {
        let defIds = []
        if (rows.length > 0) {
          try { defIds = JSON.parse(rows[0].defeated_ids || '[]') } catch(_) {}
        }
        if (!defIds.includes(stageId)) {
          defIds.push(stageId)
          if (rows.length > 0) {
            pool.query('UPDATE campaign_progress SET defeated_ids = ? WHERE username = ?', [JSON.stringify(defIds), pName])
          } else {
            pool.query('INSERT INTO campaign_progress (username, defeated_ids) VALUES (?, ?)', [pName, JSON.stringify(defIds)])
          }
          sendCommand(`tellraw ${pName} {"text":"[Kampány] Új kihívót győztél le! Nyisd meg a Launchert a jutalom átvételéhez!","color":"green","bold":true}`)
        }
      }).catch(e => console.error('[Campaign] DB hiba defeat update-nél:', e.message))
    }
  }

  mcProcess.stdout.on('data', (data) => {
    process.stdout.write(data) // Továbbítjuk a konzolra

    const text = data.toString()

    // Gyors pre-filter: ha a chunk nem tartalmaz kulcsszavakat, ne parse-oljuk soronként.
    // Ez csökkenti a regex overhead-et nagy log volumennél (pl. Cobblemon debug spam).
    const hasDone  = text.includes('For help, type "help"')
    const hasJoin  = text.includes('joined the game')
    const hasLeave = text.includes('left the game')
    const hasCamp  = text.includes('[CAMPAIGN_DEFEAT]')
    if (!hasDone && !hasJoin && !hasLeave && !hasCamp) return

    const lines = text.split('\n')
    for (const line of lines) {
      // Whitelist bekapcsolása amikor a szerver kész
      if (hasDone && RE_DONE.test(line)) {
        console.log('[Minecraft] Szerver kész, whitelist bekapcsolása és gamerule beállítása...')
        isServerReady = true
        serverEvents.emit('ready')
        sendCommand('whitelist on')
        sendCommand('gamerule keepInventory true')
        if (currentShowcase) {
          sendCommand(`say [Server] A mai nap Pokémonja: ${currentShowcase.name}! Spawn rate BOOST aktív!`)
        }
      }

      // Campaign Defeat parser (Saját [CAMPAIGN_DEFEAT] tag alapján)
      if (hasCamp && RE_CAMPAIGN.test(line)) {
        const campMatch = line.match(RE_CAMPAIGN)
        if (campMatch) {
          triggerCampaignDefeat(campMatch[1], campMatch[2])
        }
      }

      // Advancement parser (Kihívások figyelése)
      const hasAdv = text.includes('has made the advancement')
      if (hasAdv) {
        const RE_ADV = /:\s+([a-zA-Z0-9_]{3,16})\s+has made the advancement\s+\[(.*?)\]/
        const advMatch = line.match(RE_ADV)
        if (advMatch) {
          const pName = advMatch[1]
          const advName = advMatch[2]
          
          // Badge mapping
          const BADGE_MAP = {
            'Boulder Badge': 'brock',
            'Cascade Badge': 'misty',
            'Thunder Badge': 'lt_surge',
            'Rainbow Badge': 'erika',
            'Soul Badge': 'koga',
            'Marsh Badge': 'sabrina',
            'Volcano Badge': 'blaine',
            'Earth Badge': 'giovanni'
          }
          
          // Ha a megszerzett advancement neve szerepel a listánkban
          for (const [badgeText, stageId] of Object.entries(BADGE_MAP)) {
            if (advName.includes(badgeText)) {
              triggerCampaignDefeat(pName, stageId)
              break
            }
          }
        }
      }

      // "Herobrine joined the game"

      if (hasJoin) {
        const joinMatch = line.match(RE_JOIN)
        if (joinMatch) onlinePlayers.add(joinMatch[1])
      }

      // "Herobrine left the game"
      if (hasLeave) {
        const leaveMatch = line.match(RE_LEAVE)
        if (leaveMatch) {
          const user = leaveMatch[1]
          onlinePlayers.delete(user)
          console.log(`[Minecraft] ${user} kilépett. Whitelist eltávolítás 5 perc múlva (grace period)...`)
          setTimeout(() => {
            if (!onlinePlayers.has(user)) {
              console.log(`[Minecraft] ${user} grace period lejárt, eltávolítás a whitelistről.`)
              sendCommand(`easywhitelist remove ${user}`)
              sendCommand(`whitelist remove ${user}`)
              verifiedLaunchers.delete(user)
            } else {
              console.log(`[Minecraft] ${user} visszalépett a grace period alatt, whitelist megtartva.`)
            }
          }, 5 * 60 * 1000)
        }
      }
    }

  })

  mcProcess.on('close', (code) => {
    console.log(`[Minecraft] Szerver leállt (kód: ${code}).`)
    mcStatus = 'stopped'
    isServerReady = false
    mcProcess = null
    onlinePlayers.clear()
    serverEvents.emit('stopped', code)
  })
}

/**
 * Wait for the server to log the "Done" message.
 */
function waitForServerReady(timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      serverEvents.removeListener('ready', onReady)
      serverEvents.removeListener('stopped', onStopped)
      console.log('[Watchdog] Időtúllépés az indítás során.')
      reject(new Error(`Szerver indítási időtúllépés (${Math.round(timeoutMs/1000)} mp). Valószínűleg beragadt.`))
    }, timeoutMs)

    const onReady = () => {
      clearTimeout(timer)
      serverEvents.removeListener('stopped', onStopped)
      console.log('[Watchdog] Szerver kész jelzés érkezett.')
      resolve()
    }

    const onStopped = (code) => {
      clearTimeout(timer)
      serverEvents.removeListener('ready', onReady)
      console.log(`[Watchdog] Szerver leállás jelzés érkezett (kód: ${code}).`)
      reject(new Error(`Szerver váratlanul leállt az indítás során (kód: ${code}).`))
    }

    serverEvents.once('ready', onReady)
    serverEvents.once('stopped', onStopped)

    if (isServerReady) {
      clearTimeout(timer)
      serverEvents.removeListener('ready', onReady)
      serverEvents.removeListener('stopped', onStopped)
      console.log('[Watchdog] Szerver már korábban kész volt.')
      resolve()
    }
  })
}

function sendCommand(cmd) {
  if (mcProcess && mcStatus === 'running') {
    mcProcess.stdin.write(cmd + '\n')
    console.log(`[Minecraft-CMD] Sent: ${cmd}`)
  }
}

function stopMinecraft() {
  if (mcStatus === 'running' && mcProcess) {
    console.log('[Minecraft] Leállítás kérése...')
    mcProcess.kill('SIGINT')
  }
}

// ── Worker Thread Management ──────────────────────────────────
// A CPU/IO intenzív feladatok (manifest hash, leaderboard sync) külön
// worker thread-eken futnak, hogy a főszál event loop-ja szabad maradjon.
// Ez biztosítja, hogy az MC STDIN/STDOUT mindig időben kiszolgált legyen.

let _manifestWorker = null
let _leaderboardWorker = null

/**
 * Visszaadja (vagy létrehozza) a manifest worker thread-et.
 * Crash esetén null-ra állítja, hogy a következő hívásnál újra létrejöjjön.
 */
function getManifestWorker() {
  if (!_manifestWorker) {
    _manifestWorker = new Worker(path.join(__dirname, 'manifest-worker.js'))
    _manifestWorker.on('error', err => {
      console.error('[ManifestWorker] Hiba:', err.message)
      _manifestWorker = null
    })
    _manifestWorker.on('exit', code => {
      if (code !== 0) {
        console.warn(`[ManifestWorker] Leállt (kód: ${code}), újraindítás következő hívásnál.`)
        _manifestWorker = null
      }
    })
    console.log('[ManifestWorker] Worker thread elindítva.')
  }
  return _manifestWorker
}

function getLeaderboardWorker() {
  if (!_leaderboardWorker) {
    _leaderboardWorker = new Worker(path.join(__dirname, 'leaderboard-worker.js'))
    _leaderboardWorker.on('error', err => {
      console.error('[LeaderboardWorker] Hiba:', err.message)
      _leaderboardWorker = null
    })
    _leaderboardWorker.on('exit', code => {
      if (code !== 0) {
        console.warn(`[LeaderboardWorker] Leállt (kód: ${code}), újraindítás következő hívásnál.`)
        _leaderboardWorker = null
      }
    })
    console.log('[LeaderboardWorker] Worker thread elindítva.')
  }
  return _leaderboardWorker
}

/** Leállítja mindkét worker thread-et (graceful shutdown esetén). */
function terminateWorkers() {
  if (_manifestWorker)   { _manifestWorker.terminate();   _manifestWorker = null }
  if (_leaderboardWorker){ _leaderboardWorker.terminate(); _leaderboardWorker = null }
}

// ── Manifest builder ──────────────────────────────────────────

let cachedManifest = null
let manifestBuildPromise = null // Megakadályozza a párhuzamos újraépítést

/**
 * Async manifest getter – ha nincs cache, a worker thread-en újraépíti.
 * Ha már folyamatban van egy újraépítés, ugyanazt a Promise-t adja vissza.
 */
async function getManifest() {
  if (cachedManifest) return cachedManifest
  if (manifestBuildPromise) return manifestBuildPromise

  console.log('[ManifestWorker] Új manifest generálása (worker thread)...')
  manifestBuildPromise = buildManifest().then(m => {
    cachedManifest = m
    manifestBuildPromise = null
    return m
  }).catch(err => {
    manifestBuildPromise = null
    throw err
  })
  return manifestBuildPromise
}

function invalidateManifest() {
  cachedManifest = null
}

/**
 * Worker thread-en futtatja a manifest építést.
 * A főszál event loop-ja teljesen szabad marad a SHA256 hash számítás alatt.
 */
function buildManifest() {
  return new Promise((resolve, reject) => {
    const worker = getManifestWorker()

    const onMessage = (msg) => {
      worker.off('message', onMessage)
      worker.off('error', onError)
      if (msg.type === 'result') {
        console.log(`[ManifestWorker] Kész: ${msg.manifest.modCount} mod, ${Object.values(msg.manifest.folders).reduce((a, b) => a + b, 0)} fájl.`)
        resolve(msg.manifest)
      } else {
        reject(new Error(msg.message))
      }
    }

    const onError = (err) => {
      worker.off('message', onMessage)
      reject(err)
    }

    worker.on('message', onMessage)
    worker.once('error', onError)
    worker.postMessage({ type: 'build', dirs: DIRS, syncFolders: SYNC_FOLDERS })
  })
}

/**
 * Applies a Mojang skin by username – no external URL hosting needed.
 * The mod fetches the skin directly from Mojang's CDN.
 */
function applySkinMojang(username, mojangUsername, res) {
  const cmd = `skin set mojang ${mojangUsername} ${username}`
  console.log(`[Skins] SR parancs küldése (mojang): ${cmd}`)
  sendCommand(cmd)

  if (!res.writableEnded) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true, type: 'mojang', skinSource: mojangUsername }))
  }
}

/**
 * Applies a skin from a URL hosted on this server via the MineSkin API.
 * NOTE: The skin URL must be publicly accessible from the internet (mineskin.org fetches it).
 */
function applySkinFromLocal(req, username, res) {
  // Derive the public base URL from the incoming request's Host header
  const host = req.headers['host'] || `localhost:${PORT}`
  // Add a timestamp query parameter (?t=...) to bypass SkinRestorer/MineSkin caches
  const skinPublicUrl = `http://${host}/skins/${username}.png?t=${Date.now()}`

  // The server runs the Fabric-native "Skin Restorer" mod (slug: skinrestorer, v2.7.x).
  // Its command syntax is: skin set web (classic|slim) "<url>" [<targets>]
  const cmd = `skin set web classic "${skinPublicUrl}" ${username}`
  console.log(`[Skins] SR parancs küldése (web): ${cmd}`)
  sendCommand(cmd)

  if (!res.writableEnded) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true, url: skinPublicUrl }))
  }
}

/**
 * Leaderboard szinkronizálás – worker thread-en fut.
 * A fájlolvasás és DB upsert teljesen izolált a főszál event loop-jától.
 */
function syncLeaderboardFromFiles() {
  if (!pool) return Promise.resolve()

  return new Promise((resolve) => {
    console.log('[LeaderboardWorker] Szinkronizálás indítása (worker thread)...')
    const worker = getLeaderboardWorker()

    const onMessage = (msg) => {
      worker.off('message', onMessage)
      if (msg.type === 'done') {
        console.log(`[LeaderboardWorker] Szinkronizálás kész. (${msg.count} játékos)`)
      } else if (msg.type === 'error') {
        console.error('[LeaderboardWorker] Hiba:', msg.message)
      }
      resolve()
    }

    worker.on('message', onMessage)
    worker.postMessage({
      type: 'sync',
      statsDir:      path.join(DATA_DIR, 'world', 'stats'),
      cobbleDir:     path.join(DATA_DIR, 'world', 'cobblemonplayerdata'),
      usercachePath: path.join(DATA_DIR, 'usercache.json'),
      dbConfig
    })
  })
}

// Szinkronizálás 15 percenként
setInterval(syncLeaderboardFromFiles, 15 * 60 * 1000)

// ── Request handler ──────────────────────────────────────────

async function handleRequest(req, res) {
  const url = req.url.split('?')[0].replace(/\/+/g, '/')
  // Csak az érdekes végpontokat logoljuk (polling végpontok spam-et okoznának)
  if (!url.startsWith('/api/status') && !url.startsWith('/api/showcase')) {
    console.log(`[Request] ${req.method} ${url}`)
  }

  // CORS – allow the Electron renderer / LAN clients
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  // ── Skin Serving (GET/HEAD /skins/:name.png) ─────────────
  // MineSkin.org sends a HEAD before GET to validate the URL.
  // If HEAD returns 404, MineSkin aborts immediately.
  if ((req.method === 'GET' || req.method === 'HEAD') && url.startsWith('/skins/')) {
    const fileName = path.basename(url).replace(/['"\s]/g, '')
    const filePath = path.resolve(SKINS_DIR, fileName)

    console.log(`[Skins-${req.method}] Request: ${url} -> ${filePath}`)

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const stat = fs.statSync(filePath)
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': stat.size,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      })
      // HEAD: only headers, no body (MineSkin uses this to validate the URL exists)
      if (req.method === 'HEAD') return res.end()
      return fs.createReadStream(filePath).pipe(res)
    } else {
      console.warn(`[Skins-${req.method}] 404 - File not found: ${filePath}`)
      res.writeHead(404, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: 'Skin not found' }))
    }
  }

  // ── Debug Skins (GET /api/test-skins) ─────────────────────
  if (req.method === 'GET' && url === '/api/test-skins') {
    try {
      const files = fs.readdirSync(SKINS_DIR)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({
        skins_dir: path.resolve(SKINS_DIR),
        exists: fs.existsSync(SKINS_DIR),
        files: files,
        cwd: process.cwd(),
        dirname: __dirname
      }, null, 2))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: e.message, path: SKINS_DIR }))
    }
  }

  // ── Skin Upload (POST /api/upload-skin) ───────────────────
  // Note: No auth for this specifically to allow launcher to upload without login
  if (req.method === 'POST' && url === '/api/upload-skin') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { username, skinData, isUrl, skinType, mojangUsername } = JSON.parse(body)
        if (!username || !skinData) throw new Error('Hiányzó adatok.')

        // ── Mojang skin: no file download needed ─────────────────
        if (skinType === 'mojang' && mojangUsername) {
          applySkinMojang(username, mojangUsername, res)
          return
        }

        const savePath = path.join(SKINS_DIR, `${username}.png`)

        const onSaved = () => {
          console.log(`[Skins] Skin mentve: ${username}`)
          // Apply via SkinRestorer using this server's own public URL
          applySkinFromLocal(req, username, res)
        }

        if (isUrl) {
          // Download the skin PNG from the provided URL
          downloadFile(skinData, savePath).then(onSaved).catch(e => {
            res.writeHead(500)
            res.end(JSON.stringify({ error: e.message }))
          })
        } else {
          // Base64 encoded PNG
          const base64 = skinData.replace(/^data:image\/\w+;base64,/, '')
          fs.writeFileSync(savePath, base64, 'base64')
          onSaved()
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // ── Auth API (nem igényel tokent) ────────────────────────────
  if (url === '/admin/api/auth/status') {
    const auth = loadAuth()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ hasPassword: !!auth }))
    return
  }

  if (url === '/admin/api/auth/setup' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { password } = JSON.parse(body)
        if (!password || password.length < 6) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'A jelszónak legalább 6 karakter hosszúnak kell lennie.' }))
        }
        if (loadAuth()) {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Jelszó már be van állítva.' }))
        }
        const authData = await hashPassword(password)
        saveAuth(authData)
        const token = generateToken()
        authTokens.set(token, Date.now() + 24 * 3600 * 1000)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, token }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  if (url === '/admin/api/auth/login' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { password } = JSON.parse(body)
        const auth = loadAuth()
        if (!auth) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Nincs beállítva jelszó.' }))
        }
        const isValid = await verifyPassword(password, auth.salt, auth.hash)
        if (!isValid) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Hibás jelszó!' }))
        }
        const token = generateToken()
        authTokens.set(token, Date.now() + 24 * 3600 * 1000)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, token }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  if (url === '/admin/api/auth/logout' && req.method === 'POST') {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim()
    authTokens.delete(token)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true }))
    return
  }

  // ── Auth guard – minden /admin/api/* végpont védelme ─────────
  if (url.startsWith('/admin/api/')) {
    if (!checkAuth(req, res)) return
  }

  // ── Serve Launcher App (at /app) ───────────────────────────
  // Redirect /app → /app/ so that relative asset paths resolve correctly
  if (url === '/app') {
    res.writeHead(301, { 'Location': '/app/' })
    res.end()
    return
  }

  if (url === '/app/' || url === '/app/index.html') {
    const filePath = path.join(DIST_DIR, 'index.html')
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      })
      fs.createReadStream(filePath).pipe(res)
      return
    }
  }

  // Helper: serve a file from DIST_DIR by relative path
  function serveDistFile(relPath, res) {
    const filePath = path.join(DIST_DIR, relPath)
    if (relPath.includes('..') || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false
    const ext = path.extname(relPath)
    const mimeTypes = {
      '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
      '.json': 'application/json', '.ico': 'image/x-icon',
      '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
    }
    const isAsset = ['.png', '.jpg', '.jpeg', '.svg', '.woff', '.woff2', '.ttf'].includes(ext)
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache'
    })
    fs.createReadStream(filePath).pipe(res)
    return true
  }

  // ── Web installer lang files (/lang/xx.json) ─────────────────
  if (url.startsWith('/lang/')) {
    const langFile = path.basename(url) // e.g. 'hu.json'
    const candidates = [
      path.join(WEB_INSTALLER_DIR, 'lang', langFile),
      path.join(__dirname, '..', 'web-installer', 'lang', langFile),
    ]
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
        fs.createReadStream(filePath).pipe(res)
        return
      }
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Web installer lang file not found: ' + langFile }))
    return
  }

  // ── Launcher app lang files (/app/lang/xx.json) ───────────────
  // Tries dist/lang/ first, then falls back to src/public/lang/ in the repo.
  if (url.startsWith('/app/lang/')) {
    const langFile = path.basename(url)
    const candidates = [
      path.join(DIST_DIR, 'lang', langFile),
      path.join(__dirname, '..', 'src', 'public', 'lang', langFile),
    ]
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
        fs.createReadStream(filePath).pipe(res)
        return
      }
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Launcher lang file not found: ' + langFile }))
    return
  }

  // Handle assets for /app/* (e.g. /app/assets/index.css or /app/index.css)
  if (url.startsWith('/app/')) {
    const relPath = url.slice(5) // remove /app/
    if (serveDistFile(relPath, res)) return
  }

  // Backwards-compat: old builds reference /assets/* directly (relative to /app without trailing slash)
  if (url.startsWith('/assets/')) {
    const relPath = url.slice(1) // keep 'assets/...'
    if (serveDistFile(relPath, res)) return
  }

  // ── Root / Landing Page ───────────────────────────────────
  if (url === '/' || url === '' || url === '/index.html') {
    const accept = req.headers['accept'] || ''

    // Ha böngésző kéri (HTML), adjuk a Web Installert
    if (accept.includes('text/html')) {
      const filePath = path.join(WEB_INSTALLER_DIR, 'index.html')
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        fs.createReadStream(filePath).pipe(res)
        return
      }
    }

    // Egyébként marad a JSON manifest (kompatibilitás miatt)
    const manifest = await getManifest()
    const info = {
      server: 'CobbleServer',
      status: mcStatus,
      port: PORT,
      modCount: manifest.modCount,
      modsDir: MODS_DIR,
      endpoints: ['/manifest', '/mods/:filename', '/api/status'],
      nextRestart: nextRestartTime,
      playersOnline: onlinePlayers.size,
      players: Array.from(onlinePlayers)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(info, null, 2))
    return
  }

  // ── Public API (Online Játékosok lekérdezése) ─────────────
  if (url === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: mcStatus,
      playersOnline: onlinePlayers.size,
      players: Array.from(onlinePlayers)
    }))
    return
  }

  // ── Showcase API ──────────────────────────────────────────
  if (url === '/api/showcase' && req.method === 'GET') {
    if (!currentShowcase) updateShowcase()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(currentShowcase))
    return
  }

  // ── Leaderboard API ───────────────────────────────────────
  if (url === '/api/leaderboard' && req.method === 'GET') {
    try {
      if (!pool) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ error: 'Az adatbázis még nem áll készen.' }))
      }

      const searchParams = new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams
      const category = searchParams.get('category') || 'playtime'
      
      // Megengedett kategóriák a SQL injection elkerülésére
      const allowedCats = ['playtime', 'caught', 'pokedex', 'shiny']
      const orderBy = allowedCats.includes(category) ? category : 'playtime'

      const [rows] = await pool.query(`
        SELECT username, ${orderBy} as value, playtime 
        FROM leaderboard 
        ORDER BY ${orderBy} DESC 
        LIMIT 10
      `)
      
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(rows))
    } catch (e) {
      console.error('[Leaderboard API Error]', e)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Belső hiba a ranglista lekérdezésekor.' }))
    }
    return
  }

  // ── Daily Rewards API ──────────────────────────────────────
  if (url === '/api/rewards/claim' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { username } = JSON.parse(body)
        if (!username || username.trim().length < 3) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Érvénytelen felhasználónév.' }))
        }
        
        if (!pool) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Adatbázis hiba.' }))
        }

        const [rows] = await pool.execute('SELECT last_claim FROM daily_rewards WHERE username = ?', [username])
        const lastClaim = rows.length > 0 ? new Date(rows[0].last_claim).getTime() : 0
        const now = Date.now()
        const twentyFourHours = 24 * 60 * 60 * 1000
        
        if (now - lastClaim < twentyFourHours) {
          const timeLeftMs = twentyFourHours - (now - lastClaim)
          const hoursLeft = Math.floor(timeLeftMs / (1000 * 60 * 60))
          const minsLeft = Math.floor((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60))
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: `Már begyűjtötted! Várj még ${hoursLeft} órát és ${minsLeft} percet.` }))
        }
        
        // Claim logic
        await pool.execute('INSERT INTO daily_rewards (username, last_claim) VALUES (?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE last_claim = CURRENT_TIMESTAMP', [username])
        
        // Execute cobbledollars command
        sendCommand(`cobbledollars add ${username} 100`)
        
        // Send tellraw message if online
        sendCommand(`tellraw ${username} {"text":"[Rendszer] Sikeresen begyűjtötted a napi jutalmad (100 CobbleDollar) a weben!","color":"green"}`)
        
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, message: 'Jutalom sikeresen begyűjtve!' }))
      } catch (e) {
        console.error('[Rewards] Hiba:', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Hiba a jutalom begyűjtésekor.' }))
      }
    })
    return
  }

  // ── Campaign API ───────────────────────────────────────────
  /**
   * A Kanto Gym → Elite 4 → Champion haladás rendszer.
   * Sorrend: Brock → Misty → Lt. Surge → Erika → Koga → Sabrina → Blaine → Giovanni
   *          → Lorelei → Bruno → Agatha → Lance → Blue (Champion)
   */
  const CAMPAIGN_STAGES = [
    // === GYM LEADERS ===
    {
      id: 'brock', stageIndex: 0, type: 'gym',
      name: 'Brock', title: 'Pewter City Gym Leader',
      badge: 'Boulder Badge', badgeIcon: '🪨',
      type2: 'Rock', specialty: 'Kő típusú Pokémonok',
      pokemon: ['Geodude (Lv 13)', 'Vulpix (Lv 14)', 'Onix (Lv 14)', 'Archen (Lv 12)'],
      levelCap: 14,
      hint: 'Keress meg egy kőhegyi területen (Mountain / Stony Peaks biom). Víz vagy Fű típusú Pokémon ajánlott!',
      reward: { cobbledollars: 500, items: ['cobblemon:great_ball 5'] },
      rewardText: '500 CobbleDollar + 5 Great Ball',
      sprite: 'brock'
    },
    {
      id: 'misty', stageIndex: 1, type: 'gym',
      name: 'Misty', title: 'Cerulean City Gym Leader',
      badge: 'Cascade Badge', badgeIcon: '💧',
      type2: 'Water', specialty: 'Víz típusú Pokémonok',
      pokemon: ['Frogadier (Lv 25)', 'Floatzel (Lv 25)', 'Starmie (Lv 27)', 'Lanturn (Lv 25)'],
      levelCap: 27,
      hint: 'Tengerpart vagy folyóparti területen (Beach / River biom) találod. Elektromos vagy Fű típus hatékony!',
      reward: { cobbledollars: 1000, items: ['cobblemon:ultra_ball 5'] },
      rewardText: '1000 CobbleDollar + 5 Ultra Ball',
      sprite: 'misty'
    },
    {
      id: 'lt_surge', stageIndex: 2, type: 'gym',
      name: 'Lt. Surge', title: 'Vermilion City Gym Leader',
      badge: 'Thunder Badge', badgeIcon: '⚡',
      type2: 'Electric', specialty: 'Elektromos Pokémonok',
      pokemon: ['Pincurchin (Lv 32)', 'Raichu (Lv 33)', 'Vikavolt (Lv 33)', 'Manectric (Lv 34)', 'Boltund (Lv 33)'],
      levelCap: 34,
      hint: 'Síkságon (Plains / Savanna biom) keresd. Föld típusú Pokémon immunis az elektromosra!',
      reward: { cobbledollars: 1500, items: ['cobblemon:ultra_ball 10'] },
      rewardText: '1500 CobbleDollar + 10 Ultra Ball',
      sprite: 'lt_surge'
    },
    {
      id: 'erika', stageIndex: 3, type: 'gym',
      name: 'Erika', title: 'Celadon City Gym Leader',
      badge: 'Rainbow Badge', badgeIcon: '🌿',
      type2: 'Grass', specialty: 'Fű típusú Pokémonok',
      pokemon: ['Rillaboom (Lv 43)', 'Serperior (Lv 43)', 'Venusaur (Lv 44)', 'Meganium (Lv 44)', 'Electrode (Lv 44)'],
      levelCap: 44,
      hint: 'Erdős területen (Forest / Jungle biom) jelenik meg. Tűz, Repülő vagy Méh típus ellen gyenge!',
      reward: { cobbledollars: 2000, items: ['cobblemon:ultra_ball 15'] },
      rewardText: '2000 CobbleDollar + 15 Ultra Ball',
      sprite: 'erika'
    },
    {
      id: 'sabrina', stageIndex: 4, type: 'gym',
      name: 'Sabrina', title: 'Saffron City Gym Leader',
      badge: 'Marsh Badge', badgeIcon: '🔮',
      type2: 'Psychic', specialty: 'Pszichikus Pokémonok',
      pokemon: ['Hatterene (Lv 57)', 'Indeedee (Lv 57)', 'Crawdaunt (Lv 58)', 'Porygon2 (Lv 58)', 'Ursaluna (Lv 59)', 'Gardevoir (Lv 59)'],
      levelCap: 59,
      hint: 'Misztikus helyen (Mystical Grove / Dark Forest biom) található. Sötét vagy Szellem típus hatékony!',
      reward: { cobbledollars: 2500, items: ['cobblemon:ultra_ball 20'] },
      rewardText: '2500 CobbleDollar + 20 Ultra Ball',
      sprite: 'sabrina'
    },
    {
      id: 'koga', stageIndex: 5, type: 'gym',
      name: 'Koga', title: 'Fuchsia City Gym Leader',
      badge: 'Soul Badge', badgeIcon: '💜',
      type2: 'Poison', specialty: 'Méreg típusú Pokémonok',
      pokemon: ['Swellow (Lv 67)', 'Accelgor (Lv 68)', 'Greninja (Lv 68)', 'Drapion (Lv 68)', 'Dragapult (Lv 68)', 'Toxtricity (Lv 68)'],
      levelCap: 68,
      hint: 'Mocsaras területen (Swamp / Mangrove biom) bujkál. Föld vagy Pszichikus típus megveri!',
      reward: { cobbledollars: 3000, items: ['cobblemon:ultra_ball 25'] },
      rewardText: '3000 CobbleDollar + 25 Ultra Ball',
      sprite: 'koga'
    },
    {
      id: 'blaine', stageIndex: 6, type: 'gym',
      name: 'Blaine', title: 'Cinnabar Island Gym Leader',
      badge: 'Volcano Badge', badgeIcon: '🔥',
      type2: 'Fire', specialty: 'Tűz típusú Pokémonok',
      pokemon: ['Torkoal (Lv 75)', 'Cinderace (Lv 75)', 'Exeggutor (Lv 76)', 'Typhlosion (Lv 76)', 'Sunflora (Lv 76)', 'Charizard (Lv 76)'],
      levelCap: 76,
      hint: 'Vulkáni / sziklás területen (Basalt Deltas / Volcanic biom) él. Víz típus könnyedén legyőzi!',
      reward: { cobbledollars: 3500, items: ['cobblemon:ultra_ball 30'] },
      rewardText: '3500 CobbleDollar + 30 Ultra Ball',
      sprite: 'blaine'
    },
    {
      id: 'giovanni', stageIndex: 7, type: 'gym',
      name: 'Giovanni', title: 'Viridian City Gym Boss',
      badge: 'Earth Badge', badgeIcon: '🌍',
      type2: 'Ground', specialty: 'Föld típusú Pokémonok',
      pokemon: ['Scrafty (Lv 80)', 'Tapu Lele (Lv 80)', 'Excadrill (Lv 80)', 'Tyranitar (Lv 80)', 'Celesteela (Lv 80)', 'Mewtwo (Lv 80)'],
      levelCap: 80,
      hint: 'A Sivatagban (Desert / Mesa biom) találod a Rocket Boss t. Víz vagy Fű típus a legjobb választás!',
      reward: { cobbledollars: 5000, items: ['cobblemon:master_ball 1'] },
      rewardText: '5000 CobbleDollar + 1 Master Ball 🎉',
      sprite: 'giovanni'
    },
    // === ELITE 4 ===
    {
      id: 'lorelei', stageIndex: 8, type: 'elite4',
      name: 'Lorelei', title: 'Elit 4 – 1. tag',
      badge: 'Elite Badge I', badgeIcon: '🏅',
      type2: 'Ice', specialty: 'Jég típusú Pokémonok',
      pokemon: ['Ninetales (Lv 84)', 'Glaceon (Lv 84)', 'Rotom (Lv 85)', 'Azumarill (Lv 85)', 'Calyrex (Lv 85)', 'Abomasnow (Lv 85)'],
      levelCap: 85,
      hint: 'A fagyos hegycsúcsokon (Frozen Peaks / Snowy Slopes biom) vár. Harc vagy Kő típus ellen gyenge!',
      reward: { cobbledollars: 6000, items: ['cobblemon:ultra_ball 30'] },
      rewardText: '6000 CobbleDollar + 30 Ultra Ball',
      sprite: 'lorelei'
    },
    {
      id: 'bruno', stageIndex: 9, type: 'elite4',
      name: 'Bruno', title: 'Elit 4 – 2. tag',
      badge: 'Elite Badge II', badgeIcon: '🏅',
      type2: 'Fighting', specialty: 'Harc típusú Pokémonok',
      pokemon: ['Urshifu (Lv 84)', 'Scizor (Lv 85)', 'Terrakion (Lv 85)', 'Conkeldurr (Lv 85)', 'Zacian (Lv 85)', 'Lucario (Lv 85)'],
      levelCap: 85,
      hint: 'A hegyi harcos területen (Stone Shore / Rocky biom) edzett bajnok. Pszichikus vagy Repülő típus ellen gyenge!',
      reward: { cobbledollars: 6000, items: ['cobblemon:ultra_ball 30'] },
      rewardText: '6000 CobbleDollar + 30 Ultra Ball',
      sprite: 'bruno'
    },
    {
      id: 'agatha', stageIndex: 10, type: 'elite4',
      name: 'Agatha', title: 'Elit 4 – 3. tag',
      badge: 'Elite Badge III', badgeIcon: '🏅',
      type2: 'Ghost', specialty: 'Szellem típusú Pokémonok',
      pokemon: ['Grimmsnarl (Lv 84)', 'Dragapult (Lv 85)', 'Hydreigon (Lv 85)', 'Spectrier (Lv 85)', 'Marshadow (Lv 85)', 'Gengar (Lv 85)'],
      levelCap: 85,
      hint: 'A sötét erdőmélyen (Dark Forest / Soul Sand Valley biom) rejtőzik. Sötét típus immunis a Szellemre!',
      reward: { cobbledollars: 6000, items: ['cobblemon:ultra_ball 30'] },
      rewardText: '6000 CobbleDollar + 30 Ultra Ball',
      sprite: 'agatha'
    },
    {
      id: 'lance', stageIndex: 11, type: 'elite4',
      name: 'Lance', title: 'Elit 4 – 4. tag (Sárkány mester)',
      badge: 'Elite Badge IV', badgeIcon: '🏅',
      type2: 'Dragon', specialty: 'Sárkány típusú Pokémonok',
      pokemon: ['Garchomp (Lv 85)', 'Dragonite (Lv 85)', 'Dracozolt (Lv 85)', 'Melmetal (Lv 85)', 'Dialga (Lv 85)', 'Salamence (Lv 85)'],
      levelCap: 85,
      hint: 'A sárkányok barlangjában (Dragon biom / Extreme Hills) lakik. Jég típus NÉGYSZERESEN hatékony Sárkány ellen!',
      reward: { cobbledollars: 8000, items: ['cobblemon:ultra_ball 50'] },
      rewardText: '8000 CobbleDollar + 50 Ultra Ball',
      sprite: 'lance'
    },
    // === CHAMPION ===
    {
      id: 'blue', stageIndex: 12, type: 'champion',
      name: 'Terry', title: '👑 Bajnok',
      badge: 'Champion', badgeIcon: '👑',
      type2: 'Mixed', specialty: 'Vegyes típusú csapat',
      pokemon: ['Pheromosa (Lv 85)', 'Metagross (Lv 85)', 'Groudon (Lv 85)', 'Yveltal (Lv 85)', 'Eternatus (Lv 85)', 'Ditto (Lv 85)'],
      levelCap: 85,
      hint: 'Az utolsó kihívó – a Bajnoki Csarnokban vár. Kiegyensúlyozott, erős csapattal állj szembe!',
      reward: { cobbledollars: 15000, items: ['cobblemon:master_ball 5'] },
      rewardText: '15000 CobbleDollar + 5 Master Ball 🏆',
      sprite: 'blue'
    }
  ]

  if (url === '/api/campaign/stages' && req.method === 'GET') {
    // Csak a publikus (nem-spoiler) adat: id, stageIndex, type, badgeIcon, name, badge – semmi más
    const publicStages = CAMPAIGN_STAGES.map(s => ({
      id: s.id, stageIndex: s.stageIndex, type: s.type,
      name: s.name, badge: s.badge, badgeIcon: s.badgeIcon, type2: s.type2
    }))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify(publicStages))
  }

  if (url.startsWith('/api/campaign/status') && req.method === 'GET') {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`)
    const uname = parsedUrl.searchParams.get('username')
    if (!uname) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: 'Hiányzó username.' }))
    }
    if (!pool) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: 'Adatbázis nem elérhető.' }))
    }
    try {
      const [rows] = await pool.query('SELECT defeated_ids, claimed_ids FROM campaign_progress WHERE username = ?', [uname])
      let defeated_ids = []
      let claimed_ids = []
      if (rows.length > 0) {
        try { defeated_ids = JSON.parse(rows[0].defeated_ids || '[]') } catch(_) {}
        try { claimed_ids = JSON.parse(rows[0].claimed_ids || '[]') } catch(_) {}
      }
      
      // Az aktuális kihívó a claimed listából határozható meg
      // Mert amíg nem claimelted a jutalmat, addig annál a stádiumnál vagy.
      const currentStageIndex = claimed_ids.length
      const currentStage = CAMPAIGN_STAGES[currentStageIndex] || null
      
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ defeated_ids, claimed_ids, currentStageIndex, currentStage, total: CAMPAIGN_STAGES.length }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: 'Adatbázis hiba.' }))
    }
  }

  // Meglévő complete végpont módosítása "claim" végponttá (kliens oldalon a gomb használja)
  if (url === '/api/campaign/complete' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { username: uname, stageId } = JSON.parse(body)
        if (!uname || !stageId) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Hiányzó adatok.' }))
        }
        if (!pool) {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Adatbázis nem elérhető.' }))
        }

        // Jelenlegi haladás lekérése
        const [rows] = await pool.query('SELECT defeated_ids, claimed_ids FROM campaign_progress WHERE username = ?', [uname])
        let defeated_ids = []
        let claimed_ids = []
        if (rows.length > 0) {
          try { defeated_ids = JSON.parse(rows[0].defeated_ids || '[]') } catch(_) {}
          try { claimed_ids = JSON.parse(rows[0].claimed_ids || '[]') } catch(_) {}
        }

        // Ellenőrzés: A játékos legyőzte-e egyáltalán a játékban?
        if (!defeated_ids.includes(stageId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Ezt a trainert még nem győzted le a szerveren! Keresd meg a játékban!' }))
        }

        // Ellenőrzés: a beküldött stageId valóban a soron következő-e a claimelésben?
        const expectedStageIndex = claimed_ids.length
        const expectedStage = CAMPAIGN_STAGES[expectedStageIndex]
        if (!expectedStage || expectedStage.id !== stageId) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Nem ezt a jutalmat kellene átvenned, vagy már átvetted.' }))
        }

        // Haladás mentése
        claimed_ids.push(stageId)
        if (rows.length > 0) {
          await pool.query('UPDATE campaign_progress SET claimed_ids = ?, last_updated = NOW() WHERE username = ?',
            [JSON.stringify(claimed_ids), uname])
        } else {
          // Ha valamiért itt kerül be, de defeated id-nál került be... ez elvileg sosem fut le
        }

        // Jutalmak kiadása Minecraft parancsokkal
        const stage = expectedStage
        if (stage.reward) {
          if (stage.reward.cobbledollars) {
            sendCommand(`cobbledollars add ${uname} ${stage.reward.cobbledollars}`)
          }
          if (stage.reward.items) {
            for (const item of stage.reward.items) {
              sendCommand(`give ${uname} ${item}`)
            }
          }
          // Gratulációs üzenet a játékban a jutalomról
          const stageLabel = stage.type === 'gym' ? `Gym Badge: ${stage.badge}` : stage.type === 'elite4' ? `Elit 4: ${stage.name}` : `🏆 BAJNOK!`
          sendCommand(`tellraw ${uname} {"text":"[Kampány] Jutalmad átvéve: ${stage.name}! (${stageLabel}) Megkaptad: ${stage.rewardText}","color":"gold","bold":true}`)
        }

        console.log(`[Campaign] ${uname} átvette a jutalmat: ${stageId} (${claimed_ids.length}/${CAMPAIGN_STAGES.length})`)
        const nextStage = CAMPAIGN_STAGES[claimed_ids.length] || null
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ success: true, claimed_count: claimed_ids.length, total: CAMPAIGN_STAGES.length, nextStage }))
      } catch (e) {
        console.error('[Campaign] Hiba:', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ error: 'Szerver hiba.' }))
      }
    })
    return
  }

  if (url === '/api/campaign/reset' && req.method === 'POST') {
    // Admin-only reset (nem igényel tokent, de szerver-oldali secret kell)
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { username: uname, secret } = JSON.parse(body)
        if (secret !== LAUNCHER_SECRET) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Hozzáférés megtagadva.' }))
        }
        if (!pool) { res.writeHead(503); return res.end('{}') }
        await pool.query('DELETE FROM campaign_progress WHERE username = ?', [uname])
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ success: true }))
      } catch (e) {
        res.writeHead(500); return res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // ── Username Check API ───────────────────────────
  if (url.startsWith('/api/auth/check-username') && req.method === 'GET') {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`)
    const username = parsedUrl.searchParams.get('username')
    
    if (!username) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: 'Nincs megadva felhasználónév.' }))
    }

    if (!pool) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: 'Adatbázis nem elérhető.' }))
    }

    try {
      const [existing] = await pool.query('SELECT id FROM easyauth WHERE username = ?', [username])
      const available = existing.length === 0
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ available }))
    } catch (e) {
      console.error('[Auth] Check username hiba:', e)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Szerver hiba.' }))
    }
    return
  }

  // ── Registration API ─────────────────────────────
  if (url === '/api/auth/register' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { username, password } = JSON.parse(body)
        if (!username || !password || username.length < 3 || password.length < 6) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Érvénytelen adatok.' }))
        }

        if (!pool) {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Adatbázis nem elérhető.' }))
        }

        const [existing] = await pool.query('SELECT id FROM easyauth WHERE username = ?', [username])
        if (existing.length > 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Ez a felhasználónév már foglalt.' }))
        }

        const hash = await bcrypt.hash(password, 12)
        const playerUuid = getOfflineUUID(username)
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress.replace(/^.*:/, '')
        
        const data = {
          password: hash,
          last_ip: ip,
          last_authenticated_date: new Date().toISOString(),
          login_tries: 0,
          last_kicked_date: "1970-01-01T00:00:00Z",
          online_account: "UNKNOWN",
          registration_date: new Date().toISOString(),
          data_version: 1
        }

        await pool.query('INSERT INTO easyauth (username, username_lower, uuid, data, last_ip) VALUES (?, ?, ?, ?, ?)', [username, username.toLowerCase(), playerUuid, JSON.stringify(data), ip])
        
        console.log(`[Auth] Új EasyAuth regisztráció: ${username}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, message: 'Sikeres regisztráció!', username, uuid: playerUuid }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Szerver hiba.' }))
      }
    })
    return
  }

  // ── Login API ─────────────────────────────
  if (url === '/api/auth/login' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { username, password } = JSON.parse(body)
        if (!pool) {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Adatbázis nem elérhető.' }))
        }

        const [users] = await pool.query('SELECT data, uuid FROM easyauth WHERE username = ?', [username])
        if (users.length === 0) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Hibás adatok.' }))
        }

        const user = users[0]
        const userData = JSON.parse(user.data || '{}')
        const match = await bcrypt.compare(password, userData.password || '')
        if (!match) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Hibás adatok.' }))
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, uuid: user.uuid, username }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Szerver hiba.' }))
      }
    })
    return
  }

  // ── Launcher Verification API ─────────────────────────────
  if (url === '/api/launcher/verify' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { username, secret, hwid, profileId, uuid: requestedUuid } = JSON.parse(body)
        if (secret !== LAUNCHER_SECRET) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Érvénytelen titkos kód.' }))
        }

        const ip = req.socket.remoteAddress.replace(/^.*:/, '') // IPv4 formátum kinyerése

        let playerUuid = null
        if (pool && hwid && profileId) {
          try {
            if (requestedUuid) {
              playerUuid = requestedUuid
              await pool.query('INSERT INTO players (hwid, profile_id, username, uuid) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE username = ?, uuid = ?, last_login = NOW()', 
                [hwid, profileId, username, playerUuid, username, playerUuid])
              
              const [rows] = await pool.query('SELECT uuid FROM players WHERE hwid = ? AND profile_id = ?', [hwid, profileId])
              if (rows.length > 0) {
                playerUuid = rows[0].uuid
                await pool.query('UPDATE players SET username = ?, last_login = NOW() WHERE hwid = ? AND profile_id = ?', [username, hwid, profileId])
                console.log(`[Verification] Ismert profil: ${username} (Profile: ${profileId}) -> ${playerUuid}`)
              } else {
                playerUuid = getOfflineUUID(username)
                await pool.query('INSERT INTO players (hwid, profile_id, username, uuid) VALUES (?, ?, ?, ?)', [hwid, profileId, username, playerUuid])
                console.log(`[Verification] Új profil regisztrálva: ${username} (Profile: ${profileId}) -> ${playerUuid}`)
              }
            }

            // ── EASYAUTH AUTO-LOGIN BRIDGE ──
            // Minden sikeres indításkor (Play gomb) frissítjük a játékos IP-jét az adatbázisban,
            // így mire ténylegesen csatlakozik a Minecraft szerverhez, az EasyAuth látni fogja az új IP-t
            // és a Session funkció miatt automatikusan beengedi jelszó nélkül!
            const [eRows] = await pool.query('SELECT data FROM easyauth WHERE username = ?', [username])
            if (eRows.length > 0) {
              const eData = JSON.parse(eRows[0].data || '{}')
              eData.last_ip = ip
              eData.last_authenticated_date = new Date().toISOString()
              await pool.query('UPDATE easyauth SET data = ?, last_ip = ? WHERE username = ?', [JSON.stringify(eData), ip, username])
              console.log(`[Verification] EasyAuth IP frissítve az automatikus belépéshez: ${username} -> ${ip}`)
            }

          } catch (dbErr) {
            console.error('[Verification] DB hiba:', dbErr.message)
          }
        }

        console.log(`[Verification] Sikeres igazolás: ${username} (IP: ${ip})`)

        // Hozzáadás a whitelisthez
        sendCommand('whitelist on')
        sendCommand(`easywhitelist add ${username}`)
        sendCommand(`whitelist add ${username}`) // Backup vanilla whitelist
        sendCommand('whitelist reload')

        // Eltároljuk az igazolást (10 percig érvényes)
        const JOIN_TIMEOUT = 10 * 60 * 1000
        verifiedLaunchers.set(username, { ip, expiry: Date.now() + JOIN_TIMEOUT, uuid: playerUuid })

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, uuid: playerUuid }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // ── Serve Web Installer assets (app.js, style.css, images, releases) ──
  const allowedExtensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.exe', '.AppImage', '.deb', '.zip', '.dmg', '.json', '.ico']
  const requestedFile = url.startsWith('/') ? url.slice(1) : url

  // Basic security: prevent directory traversal
  if (requestedFile.includes('..')) return

  const filePath = path.join(WEB_INSTALLER_DIR, requestedFile)
  const ext = path.extname(requestedFile)

  if (allowedExtensions.includes(ext) && fs.existsSync(filePath)) {
    const mimeTypes = {
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.json': 'application/json',
      '.ico': 'image/x-icon',
      '.exe': 'application/x-msdownload',
      '.AppImage': 'application/octet-stream',
      '.deb': 'application/vnd.debian.binary-package',
      '.zip': 'application/zip',
      '.dmg': 'application/x-apple-diskimage'
    }
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400'
    })
    fs.createReadStream(filePath).pipe(res)
    return
  }

  // ── Manifest ─────────────────────────────────────────────
  if (url === '/manifest') {
    let manifest
    try {
      manifest = await getManifest()
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(manifest))
    console.log(`[${ts()}] GET /manifest → ${manifest.modCount} mod`)
    return
  }

  // ── Sync File download ─────────────────────────────────────
  for (const folder of SYNC_FOLDERS) {
    if (url.startsWith(`/${folder}/`)) {
      const relPath = decodeURIComponent(url.slice(folder.length + 2))
      const filePath = path.join(DIRS[folder], relPath)
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        fs.createReadStream(filePath).pipe(res)
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'File not found' }))
      }
      return
    }
  }

  // ── Admin UI Static Files ──────────────────────────────────
  if (url === '/admin' || url === '/admin/') {
    res.writeHead(302, { 'Location': '/admin/index.html' })
    res.end()
    return
  }
  if (url.startsWith('/admin/')) {
    const filename = url.slice(7)
    if (!filename.includes('..')) {
      const ext = path.extname(filename)
      const mimeTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' }
      const filePath = path.join(PUBLIC_DIR, filename)
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' })
        fs.createReadStream(filePath).pipe(res)
        return
      }
    }
  }

  // ── Admin API ─────────────────────────────────────────────
  if (url === '/admin/api/mods') {
    const manifest = await getManifest()
    let baseFiles = []
    try {
      baseFiles = JSON.parse(fs.readFileSync(path.join(DATA_DIR, '.modpack-files.json'), 'utf8'))
    } catch (e) { }

    const allMods = manifest.mods.map(m => ({
      ...m,
      isBase: baseFiles.includes(m.filename)
    }))

    // Előre a saját modokat, utána a modpack modokat
    allMods.sort((a, b) => {
      if (a.isBase === b.isBase) return a.filename.localeCompare(b.filename)
      return a.isBase ? 1 : -1
    })

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ mods: allMods }))
    return
  }

  if (url === '/admin/api/remove' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try {
        const { filename } = JSON.parse(body)
        if (filename && !filename.includes('..')) {
          const fp = path.join(MODS_DIR, filename)
          if (fs.existsSync(fp)) fs.unlinkSync(fp)
          invalidateManifest()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } else {
          throw new Error('Hibás fájlnév')
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  if (url === '/admin/api/enrich' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { hashes } = JSON.parse(body)
        if (!Array.isArray(hashes) || hashes.length === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ versions: {}, projects: {}, updates: {} }))
        }

        const modrinthPost = (path, payload) => new Promise((resolve, reject) => {
          const data = JSON.stringify(payload)
          const opt = {
            hostname: 'api.modrinth.com', path,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'CobbleServer/1.0', 'Content-Length': Buffer.byteLength(data) }
          }
          const r = https.request(opt, apiRes => {
            let d = ''
            apiRes.on('data', c => d += c)
            apiRes.on('end', () => resolve(JSON.parse(d)))
          })
          r.on('error', reject)
          r.write(data)
          r.end()
        })

        const modrinthGet = (path) => new Promise((resolve, reject) => {
          https.get(`https://api.modrinth.com${path}`, { headers: { 'User-Agent': 'CobbleServer/1.0' } }, apiRes => {
            let d = ''
            apiRes.on('data', c => d += c)
            apiRes.on('end', () => resolve(JSON.parse(d)))
          }).on('error', reject)
        })

        // 1. Get version info by sha1
        const versions = await modrinthPost('/v2/version_files', { hashes, algorithm: 'sha1' })

        // 2. Batch fetch project info (icons, names) 
        const projectIds = [...new Set(Object.values(versions).map(v => v.project_id).filter(Boolean))]
        let projectsArr = []
        if (projectIds.length > 0) {
          projectsArr = await modrinthGet(`/v2/projects?ids=${encodeURIComponent(JSON.stringify(projectIds))}`)
        }
        const projects = {}
        projectsArr.forEach(p => { projects[p.id] = { title: p.title, icon_url: p.icon_url } })

        // 3. Check updates (custom mods only, passed in from frontend filter)
        const updates = await modrinthPost('/v2/version_files/update', { hashes, algorithm: 'sha1', loaders: ['fabric'], game_versions: ['1.21.1'] }).catch(() => { })

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ versions, projects, updates: updates || {} }))
      } catch (e) {
        console.error('[Enrich]', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  if (url === '/admin/api/install' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try {
        const { projectId, oldFilename } = JSON.parse(body)
        const apiUrl = `https://api.modrinth.com/v2/project/${projectId}/version?loaders=["fabric"]&game_versions=["1.21.1"]`

        https.get(apiUrl, { headers: { 'User-Agent': 'CobbleServer/1.0' } }, apiRes => {
          let data = ''
          apiRes.on('data', c => data += c)
          apiRes.on('end', () => {
            const versions = JSON.parse(data)
            if (!Array.isArray(versions) || versions.length === 0) {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Nincs elérhető verzió ehhez a modhoz (1.21.1, Fabric).' }))
              return
            }
            const latest = versions.filter(v => v.version_type === 'release')[0] || versions[0]
            const file = latest.files.find(f => f.primary) || latest.files[0]

            const dest = path.join(MODS_DIR, file.filename)

            downloadFile(file.url, dest, { hash: file.hashes?.sha1 }).then(() => {
              // Ha frissítés volt, töröljük a régit
              if (oldFilename && oldFilename !== file.filename && !oldFilename.includes('..')) {
                const oldPath = path.join(MODS_DIR, oldFilename)
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
              }
              invalidateManifest()
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true, filename: file.filename }))
            }).catch(e => {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Letöltési hiba: ' + e.message }))
            })
          })
        }).on('error', e => {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Modrinth API hiba: ' + e.message }))
        })
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // ── Config Editor APIs ──────────────────────────────────────
  if (url === '/admin/api/configs' && req.method === 'GET') {
    const configDir = path.join(DATA_DIR, 'config');
    const getConfigsRecursive = (dir, baseDir) => {
      let results = [];
      try {
        const list = fs.readdirSync(dir);
        list.forEach(file => {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat && stat.isDirectory()) {
            results = results.concat(getConfigsRecursive(fullPath, baseDir));
          } else {
            // Csak olvasható/szerkeszthető szöveges kiterjesztések
            const ext = path.extname(file).toLowerCase();
            if (['.json', '.json5', '.toml', '.properties', '.txt', '.yaml', '.yml'].includes(ext)) {
              results.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
            }
          }
        });
      } catch (e) { }
      return results;
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ configs: getConfigsRecursive(configDir, configDir) }));
    return;
  }

  if (url === '/admin/api/config/read' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { filename } = JSON.parse(body);
        if (!filename) throw new Error('Hiányzó fájlnév.');

        const configDir = path.resolve(DATA_DIR, 'config');
        const targetPath = path.resolve(configDir, filename);

        // Path traversal védelem
        if (!targetPath.startsWith(configDir)) throw new Error('Érvénytelen fájl útvonal!');
        if (!fs.existsSync(targetPath)) throw new Error('A fájl nem található!');

        const content = fs.readFileSync(targetPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url === '/admin/api/config/save' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { filename, content } = JSON.parse(body);
        if (!filename || typeof content !== 'string') throw new Error('Hiányzó vagy hibás adatok.');

        const configDir = path.resolve(DATA_DIR, 'config');
        const targetPath = path.resolve(configDir, filename);

        // Path traversal védelem
        if (!targetPath.startsWith(configDir)) throw new Error('Érvénytelen fájl útvonal!');

        // Mentjük a fájlt (ha nem létezik, létrehozza, de alapvetően csak meglévőt szerkesztünk)
        fs.writeFileSync(targetPath, content, 'utf8');
        console.log(`[Config Editor] Sikeres mentés: ${filename}`);

        // Megpróbáljuk újratölteni a szervert
        sendCommand('reload');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, reloaded: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url === '/admin/api/server/start' && req.method === 'POST') {
    startMinecraft()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: mcStatus }))
    return
  }

  if (url === '/admin/api/server/stop' && req.method === 'POST') {
    stopMinecraft()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'stopping' }))
    return
  }

  if (url === '/admin/api/server/restart' && req.method === 'POST') {
    stopMinecraft()
    const check = setInterval(() => {
      if (mcStatus === 'stopped') {
        clearInterval(check)
        startMinecraft()
      }
    }, 1000)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'restarting' }))
    return
  }

  // ── 404 ──────────────────────────────────────────────────
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found', endpoints: ['/', '/manifest', '/mods/:filename', '/admin'] }))
}

// ── Helpers ──────────────────────────────────────────────────

function ts() {
  return new Date().toTimeString().slice(0, 8)
}

function getLocalIPs() {
  const ifaces = os.networkInterfaces()
  const ips = []
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address)
    }
  }
  return ips
}

// ── Nightly Restart Scheduler ────────────────────────────────

/**
 * Ütemezi a következő hajnali 3:00-ás automatikus újraindítást.
 * Minden nap lefut: leállítja a Minecraftet, frissíti a modokat,
 * majd újraindítja a szervert.
 */
function scheduleNightlyRestart() {
  const now = new Date()
  const next = new Date()
  next.setHours(3, 0, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1) // ha már elmúlt ma 3, holnapra ütemez

  const msUntilRestart = next - now
  const msUntilWarning = msUntilRestart - 5 * 60 * 1000 // 5 perccel korábban figyelmeztet

  nextRestartTime = next.getTime()

  console.log(`[Scheduler] Next automatic restart: ${next.toLocaleString('en-US')} (in ${Math.round(msUntilRestart / 60000)} minutes)`)

  // 5 perces figyelmeztetés
  if (msUntilWarning > 0) {
    setTimeout(() => {
      const msg = '[Scheduler] ⚠️  Automatic restart in 5 minutes!'
      logInfo(msg)
      sendCommand('say [Server] Automatic restart in 5 minutes! Mod updates incoming...')
    }, msUntilWarning)
  }

  // Újraindítás időpontja
  setTimeout(async () => {
    const msgStart = '[Scheduler] 🔄 Nightly automatic restart beginning...'
    logInfo(msgStart)
    sendCommand('say [Server] Restarting now! We will be back in a few seconds.')

    // Adjunk 3 mp-et hogy a chat üzenet kimenjen
    await new Promise(r => setTimeout(r, 3000))

    // MC leállítása
    stopMinecraft()

    // Várunk amíg teljesen leáll
    await new Promise(resolve => {
      const check = setInterval(() => {
        if (mcStatus === 'stopped') { clearInterval(check); resolve() }
      }, 1000)
      setTimeout(resolve, 30000) // max 30 mp váraqcskozás
    })

    const msgStop = '[Scheduler] ⬇️  Minecraft stopped, checking for updates...'
    logInfo(msgStop)

    const skipUpdate = fs.existsSync(UPDATE_FAILED_FLAG)

    try {
      if (skipUpdate) {
        const msgSkip = '[Scheduler] ⚠️ Skipping update attempt because previous update failed. Restarting only.'
        logInfo(msgSkip)
        fs.unlinkSync(UPDATE_FAILED_FLAG) // Clear the flag so we try again next time
      } else {
        const javaPath = await install()
        activeJavaPath = javaPath
        invalidateManifest()
        const msgDone = '[Scheduler] ✅ Update packages applied, checking server health...'
        logInfo(msgDone)
      }

      await updateShowcase() // Új Pokémon választása az éjszakai újraindításnál
      startMinecraft()

      if (!skipUpdate) {
        await waitForServerReady(300000) // 5 perc watchdog
        logInfo('[Scheduler] ✅ Server is healthy, committing update.')
        commitUpdate()
      }
    } catch (err) {
      const msgErr = `[Scheduler] ❌ Update or startup failed: ${err.message}`
      logError(msgErr)

      if (!skipUpdate) {
        logInfo('[Scheduler] 🔄 Initiating rollback...')
        stopMinecraft()
        await new Promise(r => setTimeout(r, 5000))
        if (mcProcess) mcProcess.kill('SIGKILL') // Force kill if stuck
        
        rollback()
        fs.writeFileSync(UPDATE_FAILED_FLAG, 'true')
        
        logInfo('[Scheduler] 🔄 Restarting with previous working version...')
        await updateShowcase()
        startMinecraft()
      } else {
        // If it failed even with skipUpdate (normal restart failed), just log it
        logError('[Scheduler] ❌ Fatal: Server failed to start even without update!')
      }
    }

    // Következő éjszakára ütemezés
    scheduleNightlyRestart()
  }, msUntilRestart)
}

// ── Start server ─────────────────────────────────────────────

async function start() {
  try {
    // 1. Install / Update Modpack and Fabric Server
    const javaPath = await install()
    invalidateManifest()

    // 1.5 Initialize Database and Configs (Awaited to ensure configs are written first)
    await initDatabase()

    // 2. Start HTTP Sync Server
    const server = http.createServer(handleRequest)
    server.listen(PORT, '0.0.0.0', () => {
      const ips = getLocalIPs()
      console.log('\n╔══════════════════════════════════════════════╗')
      console.log('║           CobbleServer – Mod Sync            ║')
      console.log('╠══════════════════════════════════════════════╣')
      console.log(`║  Port:     ${PORT}                               ║`.slice(0, 50) + '║')
      console.log(`║  Admin UI: http://localhost:${PORT}/admin      ║`.slice(0, 50) + '║')
      ips.forEach(ip => {
        const line = `║  LAN URL:  http://${ip}:${PORT}/manifest`
        console.log((line + '                              ').slice(0, 50) + '║')
      })
      console.log('╚══════════════════════════════════════════════╝\n')
    })

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ A ${PORT} port már foglalt!`)
      } else {
        console.error('❌ Szerver hiba:', err.message)
      }
    })

    // 3. Start Minecraft Server
    activeJavaPath = javaPath
    await updateShowcase() // Pokémon választás és datapack generálás az indítás előtt
    startMinecraft()
    
    // Initial start health check (optional but good)
    waitForServerReady(300000).then(() => {
      logInfo('[Main] Server started successfully.')
      commitUpdate() // In case it was an update that needed committing
    }).catch(err => {
      logError(`[Main] Server startup warning: ${err.message}`)
    })

    // 4. Hajnali 3:00-ás automatikus újraindítás ütemezése
    scheduleNightlyRestart()

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n[Szerver] SIGINT (Ctrl+C) jelzés érkezett. Leállítás...')
      terminateWorkers()
      stopMinecraft()
      server.close()
      setTimeout(() => {
        console.log('[Szerver] Folyamat kilépése.')
        process.exit(0)
      }, 1000)
    })

  } catch (err) {
    console.error('❌ Végzetes hiba indításkor:', err)
    process.exit(1)
  }
}

start()
