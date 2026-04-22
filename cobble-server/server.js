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
const { spawn } = require('child_process')
const installer = require('./installer')
const https   = require('https')

const PORT       = parseInt(process.env.PORT || '7878', 10)
const DATA_DIR   = path.join(__dirname, 'server-data')
const MODS_DIR   = path.join(DATA_DIR, 'mods')
const PUBLIC_DIR = path.join(__dirname, 'public')

let mcProcess = null
let mcStatus = 'stopped'
let activeJavaPath = null

// Ensure mods directory exists
fs.mkdirSync(MODS_DIR, { recursive: true })

// ── Minecraft Process Management ─────────────────────────────

function startMinecraft() {
  if (mcStatus === 'running' || !activeJavaPath) return
  console.log('[Minecraft] Szerver indítása (java -jar fabric-server-launch.jar nogui)...')
  mcProcess = spawn(activeJavaPath, ['-Xmx4G', '-Xms2G', '-jar', 'fabric-server-launch.jar', 'nogui'], {
    cwd: DATA_DIR,
    stdio: 'inherit'
  })
  mcStatus = 'running'
  
  mcProcess.on('close', (code) => {
    console.log(`[Minecraft] Szerver leállt (kód: ${code}).`)
    mcStatus = 'stopped'
    mcProcess = null
  })
}

function stopMinecraft() {
  if (mcStatus === 'running' && mcProcess) {
    console.log('[Minecraft] Leállítás kérése...')
    mcProcess.kill('SIGINT')
  }
}

// ── Manifest builder ─────────────────────────────────────────

function buildManifest() {
  let files
  try {
    files = fs.readdirSync(MODS_DIR).filter(f =>
      f.endsWith('.jar') || f.endsWith('.zip')
    )
  } catch (_) {
    files = []
  }

  const mods = files.map(filename => {
    const filePath = path.join(MODS_DIR, filename)
    const buf  = fs.readFileSync(filePath)
    const hash = crypto.createHash('sha256').update(buf).digest('hex')
    const sha1 = crypto.createHash('sha1').update(buf).digest('hex')
    return { filename, hash, sha1, size: buf.length }
  })

  return {
    mods,
    modCount: mods.length,
    generatedAt: new Date().toISOString(),
    serverVersion: '1.0',
  }
}

// ── Request handler ──────────────────────────────────────────

function handleRequest(req, res) {
  // CORS – allow the Electron renderer / LAN clients
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  const url = req.url.split('?')[0]

  // ── Root status ──────────────────────────────────────────
  if (url === '/' || url === '') {
    const manifest = buildManifest()
    const info = {
      server: 'CobbleServer',
      status: mcStatus,
      port: PORT,
      modCount: manifest.modCount,
      modsDir: MODS_DIR,
      endpoints: ['/manifest', '/mods/:filename'],
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(info, null, 2))
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

  // ── Mod file download ─────────────────────────────────────
  if (url.startsWith('/mods/')) {
    const rawName = url.slice(6)                     // strip '/mods/'
    const filename = decodeURIComponent(rawName)

    // Security: prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid filename' }))
      return
    }

    const filePath = path.join(MODS_DIR, filename)
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `Nem található: ${filename}` }))
      return
    }

    const stat = fs.statSync(filePath)
    res.writeHead(200, {
      'Content-Type': 'application/java-archive',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${filename}"`,
    })
    const stream = fs.createReadStream(filePath)
    stream.pipe(res)
    stream.on('error', (err) => {
      console.error(`[${ts()}] Stream hiba (${filename}):`, err.message)
    })
    console.log(`[${ts()}] GET /mods/${filename} → ${Math.round(stat.size / 1024)} KB`)
    return
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
            const fileStream = fs.createWriteStream(dest)
            
            https.get(file.url, dlRes => {
              dlRes.pipe(fileStream)
              fileStream.on('finish', () => {
                fileStream.close()
                // Ha frissítés volt, töröljük a régit
                if (oldFilename && oldFilename !== file.filename && !oldFilename.includes('..')) {
                  const oldPath = path.join(MODS_DIR, oldFilename)
                  if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
                }
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: true, filename: file.filename }))
              })
            }).on('error', e => {
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
