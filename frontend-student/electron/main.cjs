const { app, BrowserWindow, ipcMain, globalShortcut, Menu, session } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

let mainWindow;
let isLockdownActive = false;
let embeddedServer = null;

function isWindowsAdmin() {
  if (process.platform !== 'win32') return true;
  try {
    const { execSync } = require('child_process');
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch (e) {
    try {
      const { execSync } = require('child_process');
      execSync('fsutil dirty query %systemdrive%', { stdio: 'ignore' });
      return true;
    } catch (e2) {
      return false;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🌐 EMBEDDED STATIC HTTP SERVER (for direct smartphone QR pairing over Wi-Fi & Ngrok)
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
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
      res.setHeader('Access-Control-Allow-Headers', '*');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url, `http://localhost:${port}`);
      let reqPath = parsedUrl.pathname;

      // Reverse proxy /api/* requests to local backend server (port 4000)
      if (reqPath.startsWith('/api')) {
        const proxyReq = http.request({
          hostname: '127.0.0.1',
          port: 4000,
          path: req.url,
          method: req.method,
          headers: {
            ...req.headers,
            host: '127.0.0.1:4000'
          }
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          console.error('[Embedded Server Proxy Error]', err.message);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'backend_offline', message: 'Local Proctora backend is not reachable on port 4000.' }));
        });

        req.pipe(proxyReq);
        return;
      }

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
  stopBundledAIEngine();
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

ipcMain.handle('get-admin-status', () => {
  const isAdmin = isWindowsAdmin();
  return {
    isAdmin,
    isWindows: process.platform === 'win32',
    platform: process.platform
  };
});

ipcMain.handle('relaunch-as-admin', () => {
  if (process.platform === 'win32') {
    try {
      const { spawn } = require('child_process');
      const execPath = process.execPath;
      const args = process.argv.slice(1);

      // Launch elevated process via PowerShell Start-Process -Verb RunAs
      const psArgs = args.length > 0 ? `-ArgumentList '${args.map(a => `"${a}"`).join(" ")}'` : '';
      const psCommand = `Start-Process -FilePath "${execPath}" ${psArgs} -Verb RunAs`;

      spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psCommand], {
        detached: true,
        stdio: 'ignore'
      }).unref();

      setTimeout(() => {
        app.quit();
        app.exit(0);
      }, 600);

      return { success: true };
    } catch (err) {
      console.error('[Admin Relaunch Error]', err);
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'Platform is not Windows' };
});

ipcMain.handle('get-network-info', async () => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let localIp = '127.0.0.1';
  const availableIps = [];

  const virtualKeywords = ['virtual', 'vbox', 'wsl', 'vethernet', 'hyper-v', 'vmware', 'bluetooth', 'tap', 'loopback', 'npcap', 'docker'];

  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase();
    const isVirtual = virtualKeywords.some(kw => lowerName.includes(kw));

    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        availableIps.push({ iface: name, ip: iface.address, isVirtual });
        if (!isVirtual) {
          const isWifiOrEth = lowerName.includes('wi-fi') || lowerName.includes('wlan') || lowerName.includes('wireless') || lowerName.includes('ethernet') || lowerName.startsWith('en') || lowerName.startsWith('eth');
          if (isWifiOrEth && iface.address.startsWith('192.168.')) {
            localIp = iface.address;
          } else if (localIp === '127.0.0.1' || (!localIp.startsWith('192.168.') && (iface.address.startsWith('192.168.') || iface.address.startsWith('10.')))) {
            localIp = iface.address;
          }
        }
      }
    }
  }

  let ngrokUrl = null;
  const ngrokEndpoints = ['http://127.0.0.1:4040/api/tunnels', 'http://localhost:4040/api/tunnels'];
  for (const endpoint of ngrokEndpoints) {
    try {
      const ngrokRes = await fetch(endpoint, { signal: AbortSignal.timeout(1200) });
      if (ngrokRes.ok) {
        const data = await ngrokRes.json();
        const tunnels = data.tunnels || [];
        const httpsTunnel = tunnels.find(t => t.proto === 'https');
        if (httpsTunnel) {
          ngrokUrl = httpsTunnel.public_url;
          break;
        }
      }
    } catch (e) {}
  }

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

let bundledAiProcess = null;

function startBundledAIEngine() {
  const { spawn } = require('child_process');
  const isWin = process.platform === 'win32';
  const binaryName = isWin ? 'proctora-ai.exe' : 'proctora-ai';

  const possiblePaths = [
    // Packaged Electron extraResources location
    path.join(process.resourcesPath, 'proctora-ai', binaryName),
    path.join(process.resourcesPath, 'proctora-ai', 'proctora-ai', binaryName),
    // Local development dist location
    path.join(__dirname, '../../ai-engine/dist/proctora-ai', binaryName),
    path.join(__dirname, '../ai-engine/dist/proctora-ai', binaryName)
  ];

  for (const binPath of possiblePaths) {
    if (fs.existsSync(binPath)) {
      console.log(`[Bundled AI] Found standalone AI binary at: ${binPath}`);
      try {
        bundledAiProcess = spawn(binPath, [], {
          cwd: path.dirname(binPath),
          stdio: 'pipe',
          detached: false,
          env: {
            ...process.env,
            PORT: '5001',
            PYTHONUNBUFFERED: '1'
          }
        });

        bundledAiProcess.stdout.on('data', (data) => console.log(`[Bundled AI stdout] ${data}`));
        bundledAiProcess.stderr.on('data', (data) => console.error(`[Bundled AI stderr] ${data}`));
        bundledAiProcess.on('error', (err) => console.error('[Bundled AI Spawn Error]', err));
        bundledAiProcess.on('exit', (code) => console.log(`[Bundled AI] Process exited with code ${code}`));
        return;
      } catch (err) {
        console.error('[Bundled AI Init Failed]', err);
      }
    }
  }
  console.log('[Bundled AI] No standalone proctora-ai binary found, using system/dev AI service.');
}

function stopBundledAIEngine() {
  if (bundledAiProcess) {
    try {
      if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        execSync(`taskkill /pid ${bundledAiProcess.pid} /T /F`, { stdio: 'ignore' });
      } else {
        bundledAiProcess.kill('SIGTERM');
      }
    } catch (e) {}
    bundledAiProcess = null;
  }
}

app.whenReady().then(() => {
  // 1. Auto-spawn standalone bundled AI Engine if packaged in installer
  startBundledAIEngine();

  // 2. Start embedded server for mobile companion pairing
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
  stopBundledAIEngine();
  if (embeddedServer) {
    try { embeddedServer.close(); } catch (e) {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopBundledAIEngine();
  if (embeddedServer) {
    try { embeddedServer.close(); } catch (e) {}
  }
});
