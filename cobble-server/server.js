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

const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const os = require('os')
const { spawn, execFile } = require('child_process')
const { install, downloadFile, rollback, commitUpdate, logInfo, logError } = require('./installer')
const https = require('https')
const EventEmitter = require('events')
const serverEvents = new EventEmitter()

const PORT = parseInt(process.env.PORT || '8080', 10)
const DATA_DIR = path.join(__dirname, 'server-data')
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
const LAUNCHER_SECRET = 'cobble-super-secret-key-2024' // Csak a launcher és a szerver tudja

// Ensure sync directories exist
SYNC_FOLDERS.forEach(f => {
  fs.mkdirSync(DIRS[f], { recursive: true })
})
fs.mkdirSync(SKINS_DIR, { recursive: true })
console.log(`[Skins-Init] Absolute skins directory: ${path.resolve(SKINS_DIR)}`)

// ── Auth ──────────────────────────────────────────────────────────
const AUTH_FILE = path.join(DATA_DIR, '.admin-auth.json')
const authTokens = new Map() // token → expiry ms

// ── Daily Rewards State ──────────────────────────────────────────
const REWARDS_FILE = path.join(DATA_DIR, 'daily_rewards.json')
function loadRewards() {
  try { return JSON.parse(fs.readFileSync(REWARDS_FILE, 'utf8')) } catch { return {} }
}
function saveRewards(data) {
  fs.writeFileSync(REWARDS_FILE, JSON.stringify(data))
}

function loadAuth() {
  try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')) } catch { return null }
}
function saveAuth(data) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data))
}
function hashPassword(password) {
  const salt = crypto.randomBytes(32).toString('hex')
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
  return { salt, hash }
}
function verifyPassword(password, salt, storedHash) {
  try {
    const h = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(storedHash, 'hex'))
  } catch { return false }
}
function generateToken() {
  return crypto.randomBytes(32).toString('hex')
}
function checkAuth(req, res) {
  const auth = loadAuth()
  if (!auth) return true // nincs jelszó beállítva, szabad a hozzáférés
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim()
  const expiry = authTokens.get(token)
  if (!expiry || Date.now() > expiry) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Nincs bejelentkezve.' }))
    return false
  }
  authTokens.set(token, Date.now() + 24 * 3600 * 1000) // session meghosszabbítás
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
  mcProcess = spawn(activeJavaPath, ['-Xmx4G', '-Xms2G', '-jar', 'fabric-server-launch.jar', 'nogui'], {
    cwd: DATA_DIR,
    stdio: ['pipe', 'pipe', 'inherit'] // stdout 'pipe', hogy tudjuk olvasni a játékos csatlakozásokat
  })
  mcStatus = 'running'
  isServerReady = false

  mcProcess.stdout.on('data', (data) => {
    process.stdout.write(data) // Továbbítjuk a konzolra

    const lines = data.toString().split('\n')
    for (const line of lines) {
      // Whitelist bekapcsolása amikor a szerver kész
      if (line.includes('Done (') && line.includes('s)! For help, type "help"')) {
        console.log('[Minecraft] Szerver kész, whitelist bekapcsolása...')
        isServerReady = true
        serverEvents.emit('ready')
        sendCommand('whitelist on')
      }

      // "Herobrine joined the game"
      const joinMatch = line.match(/:\s+([a-zA-Z0-9_]{3,16})\s+joined the game/)
      if (joinMatch) {
        onlinePlayers.add(joinMatch[1])
        // Ha bent van, levehetjük a whitelistről? Nem, jobb ha rajta marad amíg online.
      }

      // "Herobrine left the game"
      const leaveMatch = line.match(/:\s+([a-zA-Z0-9_]{3,16})\s+left the game/)
      if (leaveMatch) {
        const user = leaveMatch[1]
        onlinePlayers.delete(user)
        console.log(`[Minecraft] ${user} kilépett. Whitelist eltávolítás 5 perc múlva (grace period)...`)
        
        // Várjunk 5 percet mielőtt levesszük, hogy legyen idő újracsatlakozni crash esetén
        setTimeout(() => {
          if (!onlinePlayers.has(user)) {
            console.log(`[Minecraft] ${user} grace period lejárt, eltávolítás a whitelistről.`)
            sendCommand(`whitelist remove ${user}`)
            verifiedLaunchers.delete(user)
          } else {
            console.log(`[Minecraft] ${user} visszalépett a grace period alatt, whitelist megtartva.`)
          }
        }, 5 * 60 * 1000)
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

// ── Manifest builder ─────────────────────────────────────────

let cachedManifest = null

function getManifest() {
  if (!cachedManifest) {
    console.log('[Manifest] Új manifest generálása és gyorsítótárazása...')
    cachedManifest = buildManifest()
  }
  return cachedManifest
}

function invalidateManifest() {
  cachedManifest = null
}

function buildManifest() {
  const getFilesRecursive = (dir, baseDir = dir) => {
    let results = []
    try {
      const list = fs.readdirSync(dir)
      list.forEach(file => {
        const fullPath = path.join(dir, file)
        const stat = fs.statSync(fullPath)
        if (stat && stat.isDirectory()) {
          results = results.concat(getFilesRecursive(fullPath, baseDir))
        } else {
          results.push(path.relative(baseDir, fullPath))
        }
      })
    } catch { return [] }
    return results
  }

  const mapFiles = (files, dir) => files.map(relPath => {
    const filePath = path.join(dir, relPath)
    const buf = fs.readFileSync(filePath)
    const hash = crypto.createHash('sha256').update(buf).digest('hex')
    return { filename: relPath, hash, size: buf.length }
  })

  const manifest = {
    generatedAt: new Date().toISOString(),
    serverVersion: '1.3',
    folders: {}
  }

  SYNC_FOLDERS.forEach(f => {
    manifest[f] = mapFiles(getFilesRecursive(DIRS[f]), DIRS[f])
    manifest.folders[f] = manifest[f].length
  })

  // Provide a convenient modCount property (number of .jar files in the 'mods' folder)
  const allMods = manifest['mods'] || []
  manifest.modCount = allMods.filter(f => f.filename.endsWith('.jar')).length

  return manifest
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

// ── Request handler ──────────────────────────────────────────

function handleRequest(req, res) {
  const url = req.url.split('?')[0].replace(/\/+/g, '/')
  console.log(`[Request] ${req.method} ${url}`)

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
    req.on('end', () => {
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
        saveAuth(hashPassword(password))
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
    req.on('end', () => {
      try {
        const { password } = JSON.parse(body)
        const auth = loadAuth()
        if (!auth) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Nincs beállítva jelszó.' }))
        }
        if (!verifyPassword(password, auth.salt, auth.hash)) {
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
    const manifest = getManifest()
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

  // ── Leaderboard API ───────────────────────────────────────
  if (url === '/api/leaderboard' && req.method === 'GET') {
    try {
      const usercachePath = path.join(DATA_DIR, 'usercache.json')
      const statsDir = path.join(DATA_DIR, 'world', 'stats')
      
      let usercache = []
      if (fs.existsSync(usercachePath)) {
        usercache = JSON.parse(fs.readFileSync(usercachePath, 'utf8'))
      }

      let leaderboard = []
      if (fs.existsSync(statsDir)) {
        const statFiles = fs.readdirSync(statsDir)
        for (const file of statFiles) {
          if (!file.endsWith('.json')) continue
          const uuid = file.replace('.json', '')
          const user = usercache.find(u => u.uuid === uuid)
          const username = user ? user.name : 'Ismeretlen'
          
          try {
            const stats = JSON.parse(fs.readFileSync(path.join(statsDir, file), 'utf8'))
            const playtimeTicks = stats.stats?.['minecraft:custom']?.['minecraft:play_time'] || 0
            const playtimeHours = Math.floor(playtimeTicks / 20 / 60 / 60)
            
            if (playtimeHours > 0) {
              leaderboard.push({ username, playtime: playtimeHours })
            }
          } catch (e) {
            console.error(`[Leaderboard] Hiba a stat fájl olvasásakor: ${file}`)
          }
        }
      }
      
      // Sort by playtime descending, take top 10
      leaderboard.sort((a, b) => b.playtime - a.playtime)
      leaderboard = leaderboard.slice(0, 10)
      
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(leaderboard))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Belső hiba a ranglista lekérdezésekor.' }))
    }
    return
  }

  // ── Daily Rewards API ──────────────────────────────────────
  if (url === '/api/rewards/claim' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try {
        const { username } = JSON.parse(body)
        if (!username || username.trim().length < 3) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Érvénytelen felhasználónév.' }))
        }
        
        const rewards = loadRewards()
        const lastClaim = rewards[username] || 0
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
        rewards[username] = now
        saveRewards(rewards)
        
        // Execute cobbledollars command
        sendCommand(`cobbledollars add ${username} 100`)
        
        // Send tellraw message if online
        sendCommand(`tellraw ${username} {"text":"[Rendszer] Sikeresen begyűjtötted a napi jutalmad (100 CobbleDollar) a weben!","color":"green"}`)
        
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, message: 'Jutalom sikeresen begyűjtve!' }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Hiba a jutalom begyűjtésekor.' }))
      }
    })
    return
  }

  // ── Launcher Verification API ─────────────────────────────
  if (url === '/api/launcher/verify' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try {
        const { username, secret } = JSON.parse(body)
        if (secret !== LAUNCHER_SECRET) {
          console.warn(`[Verification] Hibás titkos kód: ${username}`)
          res.writeHead(403)
          return res.end(JSON.stringify({ error: 'Érvénytelen launcher kód.' }))
        }

        const ip = req.socket.remoteAddress
        console.log(`[Verification] Sikeres igazolás: ${username} (IP: ${ip})`)

        // Hozzáadás a whitelisthez
        sendCommand('whitelist on') // Biztos ami biztos
        sendCommand(`whitelist add ${username}`)
        sendCommand('whitelist reload') // Frissítjük a cache-t

        // Eltároljuk az igazolást (10 percig érvényes a belépéshez - modpacks take time)
        const JOIN_TIMEOUT = 10 * 60 * 1000
        verifiedLaunchers.set(username, { ip, expiry: Date.now() + JOIN_TIMEOUT })

        // Időzítő: ha 10 perc után sincs online, vegyük le (ha csak "próbálkozott")
        setTimeout(() => {
          if (!onlinePlayers.has(username)) {
            console.log(`[Verification] ${username} nem lépett be időben (${JOIN_TIMEOUT/1000}s), whitelist remove.`)
            sendCommand(`whitelist remove ${username}`)
            verifiedLaunchers.delete(username)
          }
        }, JOIN_TIMEOUT)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch (e) {
        res.writeHead(400)
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
      manifest = getManifest()
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
    const manifest = getManifest()
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
      setTimeout(resolve, 30000) // max 30 mp várakozás
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
