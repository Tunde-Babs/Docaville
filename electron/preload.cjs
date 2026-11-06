const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('docHubNative', {
  speechVoices: () => ipcRenderer.invoke('speech-voices'),
  speak: (text, voice, rate) => ipcRenderer.invoke('speech-speak', { text, voice, rate }),
  speechControl: (action) => ipcRenderer.invoke('speech-control', action),
  // Real on-disk path of a File the user opened/dropped. Registers it with the main process as
  // writable, so "Save" can overwrite it in place. (The page can't forge a File with another path.)
  pathForFile: (file) => {
    const p = webUtils.getPathForFile(file);
    if (p) ipcRenderer.send('allow-path', p);
    return p || null;
  },
  saveFile: (name, bytes) => ipcRenderer.invoke('save-file', { name, bytes }),
  writeFile: (path, bytes) => ipcRenderer.invoke('write-file', { path, bytes }),
  printToPDF: (landscape) => ipcRenderer.invoke('print-to-pdf', { landscape }),
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  takePendingFiles: () => ipcRenderer.invoke('take-pending-files'),
  confirmClose: (name) => ipcRenderer.invoke('confirm-close', { name }),
  setDirty: (count, title) => ipcRenderer.send('set-dirty', { count, title }),
  onOpenFiles: (cb) => ipcRenderer.on('open-files', (_e, files) => cb(files)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd)),
  onSaveAll: (handler) => ipcRenderer.on('save-all', async () => ipcRenderer.send('save-all-result', await handler())),
});
