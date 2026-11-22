const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  appVersion: process.env.SBM_APP_VERSION || '1.0.0',
  printCurrent: () => ipcRenderer.invoke('sbm:print-current'),
  checkForUpdates: () => ipcRenderer.invoke('sbm:check-updates'),
});
