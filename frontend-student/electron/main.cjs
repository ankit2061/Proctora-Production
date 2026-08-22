const { app, BrowserWindow, ipcMain, globalShortcut, Menu, session } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

let mainWindow;
let isLockdownActive = false;
let embeddedServer = null;

// ═══════════════════════════════════════════════════════════════════════════
// 🌐 EMBEDDED STATIC HTTP SERVER (for direct smartphone QR pairing over Wi-Fi)
// ═══════════════════════════════════════════════════════════════════════════
function startEmbeddedServer(port = 5173) {
  try {
    const distPath = path.join(__dirname, '../dist');
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf'
    };

    embeddedServer = http.createServer((req, res) => {
      // CORS headers for seamless cross-device streaming
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
      res.setHeader('Access-Control-Allow-Headers', '*');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url, `http://localhost:${port}`);
      let reqPath = parsedUrl.pathname;
      if (reqPath === '/') reqPath = '/index.html';

      let filePath = path.join(distPath, reqPath);

      // SPA fallback to index.html if file doesn't exist
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distPath, 'index.html');
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });

    embeddedServer.on('error', (err) => {
      console.log(`[Embedded Server] Port ${port} notice: ${err.message}`);
    });

    embeddedServer.listen(port, '0.0.0.0', () => {
      console.log(`[Embedded Server] Serving student companion on http://0.0.0.0:${port}`);
    });
  } catch (e) {
    console.error('[Embedded Server Error]', e);
  }
}

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
    minimizable: false,
    resizable: false,
    movable: false,
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

  // ─────────────────────────────────────────────────────────────────────────
  // 🔒 STRICT SECURITY & LOCKDOWN EVENT HANDLERS
  // ─────────────────────────────────────────────────────────────────────────

  // Block opening any new windows, external browsers, or popups
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.warn('[Lockdown] Blocked new window request to:', url);
    return { action: 'deny' };
  });

  // Guard navigation inside the student station
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isDev) {
      const parsed = new URL(navigationUrl);
      if (parsed.protocol !== 'file:' && !navigationUrl.includes('localhost:5173')) {
        event.preventDefault();
        console.warn('[Lockdown] Blocked navigation to:', navigationUrl);
      }
    }
  });

  // Intercept and prevent critical OS and browser shortcuts on Windows & macOS
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const isAlt = input.alt;
    const isCtrl = input.control || input.meta;
    const isShift = input.shift;
    const key = (input.key || '').toLowerCase();

    // Block Alt+Tab, Alt+F4, Alt+Space, Alt+Escape on Windows
    if (isAlt && (key === 'tab' || key === 'f4' || key === ' ' || key === 'escape')) {
      event.preventDefault();
      return;
    }

    // Block developer tools, full-screen toggle, reload (F11, F12, F5, Ctrl+R, Ctrl+Shift+I)
    if (key === 'f12' || key === 'f5' || key === 'f11') {
      event.preventDefault();
      return;
    }

    if (isCtrl && (key === 'r' || key === 'i' || key === 'w' || key === 't' || key === 'n' || key === 'u' || key === 'p' || key === 'o' || key === 's' || key === 'h' || key === 'j')) {
      event.preventDefault();
      return;
    }

    // In active lockdown, block Escape or Windows keys
    if (isLockdownActive && (key === 'escape' || key === 'meta' || key === 'super')) {
      event.preventDefault();
    }
  });

  // Prevent window minimize
  mainWindow.on('minimize', (event) => {
    if (isLockdownActive) {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.restore();
        mainWindow.focus();
      }
    }
  });

  // OS Window Blur Handler: aggressively reclaim focus and alert student during exam
  mainWindow.on('blur', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('os-event', {
        type: 'os_window_blur',
        timestamp: new Date().toISOString(),
        details: 'User switched away or lost focus from student exam station'
      });

      if (isLockdownActive) {
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(true, 'screen-saver');
            mainWindow.moveTop();
            mainWindow.focus();
          }
        }, 50);
      }
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

// ─────────────────────────────────────────────────────────────────────────
// 📡 IPC Handlers
// ─────────────────────────────────────────────────────────────────────────
ipcMain.handle('enter-lockdown', () => {
  isLockdownActive = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setSimpleFullScreen(true);
      mainWindow.setFullScreen(true);
      mainWindow.setKiosk(true);
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.setMinimizable(false);
      mainWindow.setResizable(false);
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
  isLockdownActive = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setKiosk(false);
      mainWindow.setFullScreen(false);
      mainWindow.setSimpleFullScreen(false);
    } catch (e) {}
    try {
      globalShortcut.unregisterAll();
    } catch (e) {}
    return { locked: false };
  }
  return { locked: false };
});

ipcMain.handle('quit-app', () => {
  isLockdownActive = false;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setKiosk(false);
      mainWindow.setFullScreen(false);
      mainWindow.setSimpleFullScreen(false);
      mainWindow.destroy();
    }
  } catch (e) {}
  try {
    globalShortcut.unregisterAll();
  } catch (e) {}
  if (embeddedServer) {
    try { embeddedServer.close(); } catch (e) {}
  }
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
    // Filter out virtual/loopback adapters
    const isVirtual = name.toLowerCase().includes('virtual') || name.toLowerCase().includes('vbox') || name.toLowerCase().includes('wsl');
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        availableIps.push({ iface: name, ip: iface.address });
        if (!isVirtual) {
          if (iface.address.startsWith('192.168.')) {
            localIp = iface.address; // prioritize standard home/office Wi-Fi
          } else if (localIp === '127.0.0.1' || iface.address.startsWith('10.') || iface.address.startsWith('172.')) {
            if (localIp === '127.0.0.1') localIp = iface.address;
          }
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
  // Start embedded server for mobile companion pairing
  startEmbeddedServer(5173);

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
  if (embeddedServer) {
    try { embeddedServer.close(); } catch (e) {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (embeddedServer) {
    try { embeddedServer.close(); } catch (e) {}
  }
});
