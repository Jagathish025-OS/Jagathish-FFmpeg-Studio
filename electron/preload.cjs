const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('desktopFFmpeg', {
  getPathForFile: file => webUtils.getPathForFile(file),
  runJob: request => ipcRenderer.invoke('ffmpeg:run', request),
  cancelJob: jobId => ipcRenderer.invoke('ffmpeg:cancel', jobId),
  revealFile: filePath => ipcRenderer.invoke('ffmpeg:reveal', filePath),
  openDialog: kind => ipcRenderer.invoke('ffmpeg:open-dialog', kind),
  onProgress: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('ffmpeg:progress', listener);
    return () => ipcRenderer.removeListener('ffmpeg:progress', listener);
  }
});
