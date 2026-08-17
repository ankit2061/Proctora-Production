const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  enterLockdown: () => ipcRenderer.invoke('enter-lockdown'),
  exitLockdown: () => ipcRenderer.invoke('exit-lockdown'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  onOSEvent: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('os-event', handler);
    return () => ipcRenderer.removeListener('os-event', handler);
  }
});
