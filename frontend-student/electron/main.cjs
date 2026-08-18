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
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setKiosk(false);
      mainWindow.setFullScreen(false);
      mainWindow.setSimpleFullScreen(false);
      mainWindow.setAlwaysOnTop(false);
      mainWindow.destroy();
    }
  } catch (e) {}
  try {
    globalShortcut.unregisterAll();
  } catch (e) {}
  app.quit();
  app.exit(0);
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

ipcMain.handle('get-network-info', async () => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let localIp = '127.0.0.1';
  const availableIps = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        availableIps.push({ iface: name, ip: iface.address });
        if (iface.address.startsWith('192.168.')) {
          localIp = iface.address; // prioritize standard home Wi-Fi LAN
        } else if (localIp === '127.0.0.1' || iface.address.startsWith('172.') || iface.address.startsWith('10.')) {
          if (localIp === '127.0.0.1') localIp = iface.address;
        }
      }
    }
  }

  let ngrokUrl = null;
  try {
    const ngrokRes = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(1000) });
    if (ngrokRes.ok) {
      const data = await ngrokRes.json();
      const httpsTunnel = (data.tunnels || []).find(t => t.proto === 'https');
      if (httpsTunnel) {
        ngrokUrl = httpsTunnel.public_url;
      }
    }
  } catch (e) {}

  return {
    localIp,
    availableIps,
    studentPort: 5173,
    backendPort: 4000,
    aiPort: 5001,
    ngrokUrl,
    hasNgrok: Boolean(ngrokUrl)
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
