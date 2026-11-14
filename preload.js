const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gdvNative', {
  saveFile: (name, data) => ipcRenderer.invoke('save-file', name, data),
  saveFiles: (files) => ipcRenderer.invoke('save-files', files),
  onMenu: (cb) => ipcRenderer.on('menu', (e, cmd, payload) => cb(cmd, payload)),
  platform: process.platform,
});
