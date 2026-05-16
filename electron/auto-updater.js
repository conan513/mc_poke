const { autoUpdater } = require('electron-updater');
const { ipcMain, dialog } = require('electron');
const path = require('path');

// Logging
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';

// Auto-download the update as soon as it’s found – no user prompt needed.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Minimum launcher version that supports NeoForge.
// Old clients below this must be forced to update.
const MIN_REQUIRED_VERSION = '1.0.1';

function versionIsOlderThan(current, required) {
  const a = current.split('.').map(Number);
  const b = required.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) < (b[i] || 0)) return true;
    if ((a[i] || 0) > (b[i] || 0)) return false;
  }
  return false;
}

function setupAutoUpdater(mainWindow, appVersion) {
  // Check if this launcher version is below the minimum required.
  // This blocks old Fabric-based launchers from running.
  if (versionIsOlderThan(appVersion, MIN_REQUIRED_VERSION)) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('force-update-required', {
        currentVersion: appVersion,
        minVersion: MIN_REQUIRED_VERSION,
        reason: 'neoforge_migration'
      });
    });
  }

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
    console.log('Update downloaded, restarting...');
    mainWindow.webContents.send('update-downloaded', info);
    // Automatically quit and install after a short delay to let the UI render the message
    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true);
    }, 3000);
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
