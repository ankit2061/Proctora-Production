const { app, BrowserWindow, ipcMain, globalShortcut, Menu, session } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1024,
    minHeight: 700,
    center: true,
    fullscreen: true,
    kiosk: true,
    simpleFullscreen: true,
    frame: false,
    title: 'Proctora Student Assessment Station',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#0b0f19',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      devTools: process.env.NODE_ENV === 'development' || !app.isPackaged
    }
  });

  mainWindow.maximize();
  mainWindow.setFullScreen(true);
  mainWindow.setKiosk(true);
  Menu.setApplicationMenu(null);

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:5173';
    mainWindow.loadURL(startUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // OS Window Blur / Focus Event Listeners
  mainWindow.on('blur', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('os-event', {
        type: 'os_window_blur',
        timestamp: new Date().toISOString(),
        details: 'User switched away from student application'
      });
    }
  });

  mainWindow.on('focus', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('os-event', {
        type: 'os_window_focus',
        timestamp: new Date().toISOString(),
        details: 'User returned focus to student application'
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers for Lockdown & Kiosk Mode
ipcMain.handle('enter-lockdown', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setSimpleFullScreen(true);
      mainWindow.setFullScreen(true);
      mainWindow.setKiosk(true);
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.focus();
    } catch (e) {}

    // Register blocking shortcuts
    try {
      globalShortcut.register('CommandOrControl+R', () => {});
      globalShortcut.register('CommandOrControl+Shift+R', () => {});
      globalShortcut.register('CommandOrControl+W', () => {});
      globalShortcut.register('Alt+Tab', () => {});
      globalShortcut.register('CommandOrControl+Shift+I', () => {});
      globalShortcut.register('F11', () => {});
      globalShortcut.register('F12', () => {});
      globalShortcut.register('F5', () => {});
    } catch (e) {}

    return { locked: true };
  }
  return { locked: false };
});

ipcMain.handle('exit-lockdown', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setKiosk(false);
      mainWindow.setFullScreen(false);
      mainWindow.setSimpleFullScreen(false);
      mainWindow.setAlwaysOnTop(false);
    } catch (e) {}
    globalShortcut.unregisterAll();
    return { locked: false };
  }
  return { locked: false };
});

ipcMain.handle('quit-app', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setKiosk(false);
      mainWindow.setFullScreen(false);
      mainWindow.setSimpleFullScreen(false);
      mainWindow.setAlwaysOnTop(false);
    } catch (e) {}
    globalShortcut.unregisterAll();
  }
  app.quit();
  return { success: true };
});

ipcMain.handle('get-system-info', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node
  };
});

app.whenReady().then(() => {
  // Grant camera & microphone permissions automatically
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'camera' || permission === 'microphone' || permission === 'notifications') {
      return callback(true);
    }
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'media' || permission === 'camera' || permission === 'microphone' || permission === 'notifications';
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
