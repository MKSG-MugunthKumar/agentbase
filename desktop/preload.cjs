const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentbase', {
  snapshot: (input) => ipcRenderer.invoke('snapshot', input),
  chooseStore: () => ipcRenderer.invoke('choose-store'),
  storePath: () => ipcRenderer.invoke('store-path'),
  saveSkill: (input) => ipcRenderer.invoke('save-skill', input),
  connectionStatus: () => ipcRenderer.invoke('connection-status'),
  connectionAction: (input) => ipcRenderer.invoke('connection-action', input),
  skillInstructions: (input) => ipcRenderer.invoke('skill-instructions', input),
  memoryAction: (input) => ipcRenderer.invoke('memory-action', input),
  skillTemplates: () => ipcRenderer.invoke('skill-templates'),
});
