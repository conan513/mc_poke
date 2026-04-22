const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const launcher = require('./launcher')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 680,
    minWidth: 900,
    minHeight: 580,
    frame: false,
    resizable: true,
    backgroundColor: '#0a0a12',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
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

// Install: Java + Minecraft + Modpack
ipcMain.handle('install', async (event, { username, ram }) => {
  try {
    await launcher.install({ username, ram }, (progress) => {
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
ipcMain.handle('run-update', async (event, { username, ram }) => {
  try {
    await launcher.install({ username, ram }, (progress) => {
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
