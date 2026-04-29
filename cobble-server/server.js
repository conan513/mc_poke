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

const http    = require('http')
const fs      = require('fs')
const path    = require('path')
const crypto  = require('crypto')
const os      = require('os')
const { spawn, execFile } = require('child_process')
const installer = require('./installer')
const https   = require('https')

const PORT       = parseInt(process.env.PORT || '8080', 10)
const DATA_DIR   = path.join(__dirname, 'server-data')
const SKINS_DIR  = path.join(DATA_DIR, 'skins')
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

let mcProcess = null
let mcStatus = 'stopped'
let activeJavaPath = null
let nextRestartTime = null

// Ensure sync directories exist
SYNC_FOLDERS.forEach(f => {
  fs.mkdirSync(DIRS[f], { recursive: true })
})
fs.mkdirSync(SKINS_DIR, { recursive: true })
console.log(`[Skins-Init] Absolute skins directory: ${path.resolve(SKINS_DIR)}`)

// ── Auth ──────────────────────────────────────────────────────────
const AUTH_FILE = path.join(DATA_DIR, '.admin-auth.json')
const authTokens = new Map() // token → expiry ms

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
    stdio: ['pipe', 'inherit', 'inherit']
  })
  mcStatus = 'running'
  
  mcProcess.on('close', (code) => {
    console.log(`[Minecraft] Szerver leállt (kód: ${code}).`)
    mcStatus = 'stopped'
    mcProcess = null
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
    const buf  = fs.readFileSync(filePath)
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

  // Provide a convenient modCount property (number of files in the 'mods' folder)
  manifest.modCount = (manifest['mods'] || []).length

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
          installer.downloadFile(skinData, savePath).then(onSaved).catch(e => {
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
    const manifest = buildManifest()
    const info = {
      server: 'CobbleServer',
      status: mcStatus,
      port: PORT,
      modCount: manifest.modCount,
      modsDir: MODS_DIR,
      endpoints: ['/manifest', '/mods/:filename'],
      nextRestart: nextRestartTime,
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(info, null, 2))
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
      manifest = buildManifest()
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
    const manifest = buildManifest()
    let baseFiles = []
    try {
      baseFiles = JSON.parse(fs.readFileSync(path.join(DATA_DIR, '.modpack-files.json'), 'utf8'))
    } catch (e) {}
    
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
        const updates = await modrinthPost('/v2/version_files/update', { hashes, algorithm: 'sha1', loaders: ['fabric'], game_versions: ['1.21.1'] }).catch(() => {})

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
            
            installer.downloadFile(file.url, dest, { hash: file.hashes?.sha1 }).then(() => {
              // Ha frissítés volt, töröljük a régit
              if (oldFilename && oldFilename !== file.filename && !oldFilename.includes('..')) {
                const oldPath = path.join(MODS_DIR, oldFilename)
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
              }
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
      console.log(msg)
      fs.appendFileSync(path.join(DATA_DIR, 'updater.log'), `[${new Date().toISOString()}] ${msg}\n`)
      sendCommand('say [Server] Automatic restart in 5 minutes! Mod updates incoming...')
    }, msUntilWarning)
  }

  // Újraindítás időpontja
  setTimeout(async () => {
    const msgStart = '[Scheduler] 🔄 Nightly automatic restart beginning...'
    console.log(msgStart)
    fs.appendFileSync(path.join(DATA_DIR, 'updater.log'), `[${new Date().toISOString()}] ${msgStart}\n`)
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
    console.log(msgStop)
    fs.appendFileSync(path.join(DATA_DIR, 'updater.log'), `[${new Date().toISOString()}] ${msgStop}\n`)

    try {
      const javaPath = await installer.install()
      activeJavaPath = javaPath
      const msgDone = '[Scheduler] ✅ Updates complete, restarting Minecraft...'
      console.log(msgDone)
      fs.appendFileSync(path.join(DATA_DIR, 'updater.log'), `[${new Date().toISOString()}] ${msgDone}\n`)
    } catch (err) {
      const msgErr = `[Scheduler] ❌ Error during update: ${err.message}`
      console.error(msgErr)
      fs.appendFileSync(path.join(DATA_DIR, 'updater.log'), `[${new Date().toISOString()}] ${msgErr}\n`)
    }

    startMinecraft()

    // Következő éjszakára ütemezés
    scheduleNightlyRestart()
  }, msUntilRestart)
}

// ── Start server ─────────────────────────────────────────────

async function start() {
  try {
    // 1. Install / Update Modpack and Fabric Server
    const javaPath = await installer.install()
    
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

    // 4. Hajnali 3:00-ás automatikus újraindítás ütemezése
    scheduleNightlyRestart()

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n[Szerver] Leállítás kérése...')
      stopMinecraft()
      server.close()
      setTimeout(() => process.exit(0), 1000)
    })

  } catch (err) {
    console.error('❌ Végzetes hiba indításkor:', err)
    process.exit(1)
  }
}

start()
