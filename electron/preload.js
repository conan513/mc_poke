const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cobble', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),

  // App path
  getAppPath: () => ipcRenderer.invoke('get-app-path'),

  // Installation
  install: (opts) => ipcRenderer.invoke('install', opts),
  checkInstalled: () => ipcRenderer.invoke('check-installed'),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('check-updates'),
  runUpdate: (opts) => ipcRenderer.invoke('run-update', opts),

  // Launch
  launch: (opts) => ipcRenderer.invoke('launch', opts),

  // Events
  onProgress: (cb) => ipcRenderer.on('install-progress', (_, data) => cb(data)),
  onGameLog: (cb) => ipcRenderer.on('game-log', (_, data) => cb(data)),
  onGameClosed: (cb) => ipcRenderer.on('game-closed', () => cb()),

  // External links
  openExternal: (url) => ipcRenderer.send('open-external', url),
  openGameFolder: () => ipcRenderer.send('open-game-folder'),
})
