const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const launcher = require('./launcher')
const { setupAutoUpdater } = require('./auto-updater')

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
  const localFile = path.join(__dirname, '../dist/index.html')

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadURL(remoteUrl).catch(() => {
      console.log('[Electron] Remote UI load failed, falling back to local file.')
      mainWindow.loadFile(localFile)
    })
  }

  // Handle load failures (e.g. server down or no internet)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (validatedURL === remoteUrl) {
      console.warn(`[Electron] Failed to load remote UI: ${errorDescription} (${errorCode})`)
      mainWindow.loadFile(localFile)
    }
  })

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
ipcMain.handle('launch', async (event, { username, ram, serverUrl }) => {
  try {
    await launcher.launch({ username, ram, serverUrl }, (data) => {
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
