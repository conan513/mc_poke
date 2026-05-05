const { app, BrowserWindow, ipcMain, shell } = require('electron')
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256')

const path = require('path')
const fs = require('fs')
const http = require('http')
const os = require('os')
const crypto = require('crypto')
const launcher = require('./launcher')

function getHWID() {
  try {
    const interfaces = os.networkInterfaces()
    const macs = Object.values(interfaces)
      .flat()
      .filter(details => details && details.mac && details.mac !== '00:00:00:00:00:00')
      .map(details => details.mac)
      .sort()
    
    const platform = os.platform()
    const arch = os.arch()
    const cpus = os.cpus().map(c => c.model).sort()
    const totalMemory = os.totalmem()
    
    // Kombináljuk a hardver adatokat egy fix stringbe
    const rawId = `${platform}-${arch}-${cpus.join('|')}-${totalMemory}-${macs.join(',')}`
    return crypto.createHash('sha256').update(rawId).digest('hex')
  } catch (e) {
    // Fallback: ha valami hiba lenne, generálunk egy random ID-t és elmentjük
    const idPath = path.join(app.getPath('userData'), '.hwid')
    if (fs.existsSync(idPath)) return fs.readFileSync(idPath, 'utf8')
    const nid = crypto.randomUUID()
    fs.writeFileSync(idPath, nid)
    return nid
  }
}
const { setupAutoUpdater } = require('./auto-updater')

// ── Local fallback server ─────────────────────────────────────
const LOCAL_PORT = 8079
const DIST_DIR = path.join(__dirname, '../dist')
let localServer = null

function startLocalServer() {
  if (localServer) return Promise.resolve()
  return new Promise((resolve) => {
    localServer = http.createServer((req, res) => {
      // Strip /app prefix so paths match dist structure
      let urlPath = req.url.split('?')[0]
      if (urlPath === '/app' || urlPath === '/app/') urlPath = '/app/index.html'
      if (urlPath.startsWith('/app/')) urlPath = urlPath.slice(4) // → /index.html, /index.css etc.
      const filePath = path.join(DIST_DIR, urlPath)
      const ext = path.extname(filePath)
      const mimeTypes = {
        '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
        '.json': 'application/json', '.ico': 'image/x-icon',
        '.woff': 'font/woff', '.woff2': 'font/woff2',
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' })
        fs.createReadStream(filePath).pipe(res)
      } else {
        res.writeHead(404); res.end('Not found')
      }
    })
    localServer.listen(LOCAL_PORT, '127.0.0.1', () => {
      console.log(`[LocalServer] Serving dist on http://127.0.0.1:${LOCAL_PORT}`)
      resolve()
    })
  })
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// Suppress punycode deprecation warning from dependencies
const originalEmit = process.emit;
process.emit = function (name, data, ...args) {
  if (
    name === 'warning' &&
    typeof data === 'object' &&
    data.name === 'DeprecationWarning' &&
    data.message.includes('punycode')
  ) {
    return false;
  }
  return originalEmit.apply(process, [name, data, ...args]);
};

let mainWindow

// Force single instance lock
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    // Parse protocol from command line on Windows/Linux
    const url = commandLine.find(arg => arg.startsWith('cobble://'))
    if (url && mainWindow) {
      handleProtocolUrl(url)
    }
  })
}

// Register protocol client for Windows/Linux
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('cobble', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('cobble')
}

let deepLinkUrl = null

function handleProtocolUrl(url) {
  if (url === 'cobble://launch' || url === 'cobble://launch/') {
    // Send event to renderer to auto-start the game
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('protocol-launch')
    }
  }
}

app.on('open-url', (event, url) => {
  // macOS protocol handler
  event.preventDefault()
  if (app.isReady()) {
    handleProtocolUrl(url)
  } else {
    deepLinkUrl = url
  }
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 680,
    minWidth: 900,
    minHeight: 580,
    frame: false,
    resizable: true,
    backgroundColor: '#0a0a12',
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const remoteUrl = 'http://94.72.100.43:8080/app'
  const localUrl = `http://127.0.0.1:${LOCAL_PORT}/app/`

  async function loadLocalFallback() {
    console.log('[Electron] Loading local fallback server...')
    await startLocalServer()
    mainWindow.loadURL(localUrl)
  }

  if (isDev) {
    const devUrl = 'http://localhost:5173/app/'
    console.log(`[Electron] Development mode: Loading ${devUrl}`)
    mainWindow.loadURL(devUrl)
    // mainWindow.webContents.openDevTools()
  } else {
    console.log(`[Electron] Production mode: Loading ${remoteUrl}`)
    mainWindow.webContents.session.clearCache().then(() => {
      mainWindow.loadURL(remoteUrl).catch(() => loadLocalFallback())
    })
  }

  // Handle load failures (e.g. server down or no internet)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (validatedURL === remoteUrl || validatedURL === remoteUrl + '/') {
      console.warn(`[Electron] Failed to load remote UI: ${errorDescription} (${errorCode})`)
      loadLocalFallback()
    }
  })

  // Handle window focus/blur to trigger power saving in renderer
  mainWindow.on('focus', () => mainWindow.webContents.send('power-state', 'active'))
  mainWindow.on('blur', () => mainWindow.webContents.send('power-state', 'save'))

  // Initialize auto-updater
  setupAutoUpdater(mainWindow)

}

app.whenReady().then(() => {
  createWindow()
  
  // Check if opened via protocol on Windows/Linux
  const url = process.argv.find(arg => arg.startsWith('cobble://'))
  if (url) {
    setTimeout(() => handleProtocolUrl(url), 1500) // Wait for UI to load
  } else if (deepLinkUrl) {
    // macOS
    setTimeout(() => handleProtocolUrl(deepLinkUrl), 1500)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC Handlers ──────────────────────────────────────────────

ipcMain.on('window-minimize', () => mainWindow.minimize())
ipcMain.on('window-close', () => {
  app.quit()
})

ipcMain.handle('get-app-path', () => app.getPath('userData'))
ipcMain.handle('get-locale', () => app.getLocale())
ipcMain.handle('get-hwid', () => getHWID())
ipcMain.handle('get-total-mem', async () => {
  // Primary: os.totalmem() works on all platforms under normal conditions
  const primary = os.totalmem()
  if (primary && primary > 0) return primary

  // Fallback for Linux: read /proc/meminfo directly
  if (process.platform === 'linux') {
    try {
      const data = fs.readFileSync('/proc/meminfo', 'utf8')
      const match = data.match(/MemTotal:\s+(\d+)\s+kB/)
      if (match) {
        const bytes = parseInt(match[1]) * 1024
        if (bytes > 0) {
          console.log('[RAM] Linux fallback via /proc/meminfo:', bytes)
          return bytes
        }
      }
    } catch (e) {
      console.warn('[RAM] /proc/meminfo fallback failed:', e.message)
    }
  }

  // Fallback for macOS: use sysctl hw.memsize
  if (process.platform === 'darwin') {
    try {
      const { execSync } = require('child_process')
      const result = execSync('sysctl -n hw.memsize', { timeout: 2000 }).toString().trim()
      const bytes = parseInt(result)
      if (!isNaN(bytes) && bytes > 0) {
        console.log('[RAM] macOS fallback via sysctl:', bytes)
        return bytes
      }
    } catch (e) {
      console.warn('[RAM] sysctl fallback failed:', e.message)
    }
  }

  // Fallback for Windows: use WMIC (os.totalmem should always work on Windows, but just in case)
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process')
      const result = execSync('wmic OS get TotalVisibleMemorySize /Value', { timeout: 3000 }).toString()
      const match = result.match(/TotalVisibleMemorySize=(\d+)/)
      if (match) {
        const bytes = parseInt(match[1]) * 1024
        if (bytes > 0) {
          console.log('[RAM] Windows fallback via WMIC:', bytes)
          return bytes
        }
      }
    } catch (e) {
      console.warn('[RAM] WMIC fallback failed:', e.message)
    }
  }

  console.error('[RAM] All detection methods failed, returning 0')
  return 0
})


// Install / First Setup
ipcMain.handle('install', async (event, { username, ram, serverUrl }) => {
  try {
    await launcher.install({ username, ram, serverUrl }, (progress) => {
      mainWindow.webContents.send('install-progress', progress)
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// Background update check (no install, just returns info)
ipcMain.handle('check-updates', async () => {
  try {
    return await launcher.checkForUpdates()
  } catch (err) {
    return { modpack: null, fabric: null }
  }
})

// Run update (same as install, but always runs through modpack+fabric steps)
ipcMain.handle('run-update', async (event, { username, ram, serverUrl }) => {
  try {
    await launcher.install({ username, ram, serverUrl }, (progress) => {
      mainWindow.webContents.send('install-progress', progress)
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// Launch game
ipcMain.handle('launch', async (event, { username, uuid, ram, serverUrl, closeOnLaunch }) => {
  try {
    await launcher.launch({ username, uuid, ram, serverUrl, closeOnLaunch }, (data) => {
      mainWindow.webContents.send('game-log', data)
    }, () => {
      mainWindow.webContents.send('game-closed')
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// Check install status
ipcMain.handle('check-installed', async () => {
  return launcher.isInstalled()
})

ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url)
})

ipcMain.on('open-game-folder', () => {
  const folder = launcher.getModpackDir()
  if (fs.existsSync(folder)) {
    shell.openPath(folder)
  } else {
    // If modpack dir doesn't exist yet, open the base game dir
    shell.openPath(path.join(app.getPath('userData'), 'cobbleverse'))
  }
})
