const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentbase', {
  snapshot: (input) => ipcRenderer.invoke('snapshot', input),
  chooseStore: () => ipcRenderer.invoke('choose-store'),
  storePath: () => ipcRenderer.invoke('store-path'),
  saveSkill: (input) => ipcRenderer.invoke('save-skill', input),
});
