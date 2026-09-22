import { contextBridge, ipcRenderer } from 'electron';

// Только уведомление о видимости; файловая система и произвольный IPC не доступны UI.
contextBridge.exposeInMainWorld('kadroskopDesktop', {
  onVisibility(callback: (visible: boolean) => void) {
    const listener = (_event: unknown, visible: boolean) => callback(visible);
    ipcRenderer.on('desktop-visibility', listener);
    return () => ipcRenderer.removeListener('desktop-visibility', listener);
  },
});
