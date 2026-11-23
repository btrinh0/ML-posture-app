const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  state: () => ipcRenderer.invoke('desk:state'),
  sample: value => ipcRenderer.invoke('desk:sample', value),
  model: pick => ipcRenderer.invoke('desk:model',pick),
  report: days => ipcRenderer.invoke('desk:report',days),
  action: (name, value) => ipcRenderer.invoke('desk:action', name, value),
  onChange: listener => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('desk:change', handler);
    return () => ipcRenderer.removeListener('desk:change', handler);
  },
});
