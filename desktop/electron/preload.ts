import { contextBridge, ipcRenderer } from 'electron'

/**
 * Keep the renderer sandboxed. Add only audited, narrow desktop capabilities here.
 * Firebase runs in the renderer through the Web SDK and does not need Node access.
 */
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('desktop:open-external', url),
})
