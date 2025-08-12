const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  state: () => ipcRenderer.invoke('desk:state'),
  sample: (value) => ipcRenderer.invoke('desk:sample', value),
  onPromptClick: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('desk:showPrompt', handler);
    return () => ipcRenderer.removeListener('desk:showPrompt', handler);
  },
  action: (name, value) => ipcRenderer.invoke('desk:action', name, value),
  onChange: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('desk:change', handler);
    return () => ipcRenderer.removeListener('desk:change', handler);
  },
});
