const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cobble', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),

  // App path
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getLocale: () => ipcRenderer.invoke('get-locale'),

  // Installation
  install: (opts) => ipcRenderer.invoke('install', opts),
  checkInstalled: () => ipcRenderer.invoke('check-installed'),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('check-updates'),
  runUpdate: (opts) => ipcRenderer.invoke('run-update', opts),
  
  // Launcher Self-Updates
  checkLauncherUpdates: () => ipcRenderer.invoke('check-for-launcher-updates'),
  downloadLauncherUpdate: () => ipcRenderer.invoke('download-launcher-update'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('quit-and-install-update'),
  setUpdateServerUrl: (url) => ipcRenderer.invoke('set-update-server-url', url),

  // Launch
  launch: (opts) => ipcRenderer.invoke('launch', opts),

  // Events
  onProgress: (cb) => ipcRenderer.on('install-progress', (_, data) => cb(data)),
  onGameLog: (cb) => ipcRenderer.on('game-log', (_, data) => cb(data)),
  onGameClosed: (cb) => ipcRenderer.on('game-closed', () => cb()),
  onProtocolLaunch: (cb) => ipcRenderer.on('protocol-launch', () => cb()),
  
  // Launcher Update Events
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, info) => cb(info)),
  onUpdateDownloadProgress: (cb) => ipcRenderer.on('update-download-progress', (_, p) => cb(p)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, info) => cb(info)),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (_, err) => cb(err)),

  // External links
  openExternal: (url) => ipcRenderer.send('open-external', url),
  openGameFolder: () => ipcRenderer.send('open-game-folder'),
})
