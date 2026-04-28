const { autoUpdater } = require('electron-updater');
const { ipcMain, dialog } = require('electron');
const path = require('path');

// Logging
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';

// Disable auto download (we want to control it via UI/IPC)
autoUpdater.autoDownload = false;

function setupAutoUpdater(mainWindow) {
  
  // Check for updates every 2 hours
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
      console.error('Update check failed:', err);
    });
  }, 2 * 60 * 60 * 1000);

  // Events
  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    mainWindow.webContents.send('update-available', info);
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('Update not available.');
  });

  autoUpdater.on('error', (err) => {
    console.error('Error in auto-updater: ', err);
    mainWindow.webContents.send('update-error', err.message);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow.webContents.send('update-download-progress', progressObj);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded');
    mainWindow.webContents.send('update-downloaded', info);
  });

  // IPC Handlers
  ipcMain.handle('check-for-launcher-updates', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('download-launcher-update', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('quit-and-install-update', () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle('set-update-server-url', (event, serverUrl) => {
    if (!serverUrl) return;
    const updateUrl = `${serverUrl.replace(/\/+$/, '')}/releases/`;
    console.log(`[Updater] Feed URL beállítva: ${updateUrl}`);
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: updateUrl
    });
  });

  // Initial check
  autoUpdater.checkForUpdatesAndNotify().catch(err => {
    console.error('Initial update check failed:', err);
  });
}

module.exports = { setupAutoUpdater };
