const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let mainWindow = null;
let splashWindow = null;
let serverStarted = false;

process.env.SBM_APP_VERSION = app.getVersion();

function findAvailablePort(startPort = 3100) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1));
    });
    server.listen(startPort, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 440,
    height: 330,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    backgroundColor: '#0B1D3A',
    icon: path.join(__dirname, '..', 'public', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
}

async function startLocalBackend() {
  if (serverStarted) return process.env.PORT;
  const port = await findAvailablePort(3100);
  process.env.NODE_ENV = 'production';
  process.env.PORT = String(port);
  process.env.STANLEY_DATA_DIR = path.join(app.getPath('userData'), 'data');
  process.env.STANLEY_NO_AUTOSTART = 'false';

  const serverEntry = path.join(__dirname, '..', 'server.js');
  await import(pathToFileURL(serverEntry).href);
  serverStarted = true;
  return port;
}

function buildAppMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Print Current View',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.print({ silent: false, printBackground: true });
            }
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit Application' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen', accelerator: 'F11' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates',
          click: async () => {
            const res = await checkForApplicationUpdates();
            if (mainWindow) {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'STANLEY BUSINESS MANAGER Updates',
                message: res.message,
              });
            }
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function checkForApplicationUpdates() {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    const result = await autoUpdater.checkForUpdates();
    if (result && result.updateInfo && result.updateInfo.version !== app.getVersion()) {
      return {
        supported: true,
        message: `Update v${result.updateInfo.version} found and downloading in the background.`,
      };
    }
    return {
      supported: true,
      message: `STANLEY BUSINESS MANAGER v${app.getVersion()} is up to date.`,
    };
  } catch {
    return {
      supported: false,
      message: `Running standalone build v${app.getVersion()}. Configure release feed in electron-builder.yml for automatic over-the-air updates.`,
    };
  }
}

async function createMainWindow() {
  createSplashWindow();
  const port = await startLocalBackend();

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0B1D3A',
    title: 'STANLEY BUSINESS MANAGER',
    icon: path.join(__dirname, '..', 'public', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  buildAppMenu();

  // Open WhatsApp / external links in system browser safely
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://wa.me') || url.startsWith('mailto:') || url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('sbm:print-current', async () => {
  if (!mainWindow) return { ok: false, error: 'Window unavailable' };
  return new Promise((resolve) => {
    mainWindow.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
      resolve({ ok: success, error: failureReason });
    });
  });
});

ipcMain.handle('sbm:check-updates', async () => {
  return checkForApplicationUpdates();
});

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createMainWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
