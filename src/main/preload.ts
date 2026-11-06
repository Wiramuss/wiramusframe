// Renderer'a dar, tipli bir köprü açar. Node API'leri renderer'a sızmaz.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('wiramus', {
  invoke: (channel: string, arg?: unknown) => ipcRenderer.invoke(channel, arg),
  on: (cb: (msg: { event: string; data: unknown }) => void) => {
    const h = (_e: unknown, msg: { event: string; data: unknown }) => cb(msg);
    ipcRenderer.on('event', h);
    return () => ipcRenderer.removeListener('event', h);
  },
  onOverlay: (cb: (scan: unknown) => void) => {
    ipcRenderer.on('overlay:show', (_e, scan) => cb(scan));
  },
});
