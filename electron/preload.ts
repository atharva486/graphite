import { ipcRenderer, contextBridge } from 'electron'

// ─── Expose typed API to Renderer via contextBridge ───────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Open native file picker. Returns selected file path or null.
   */
  openFile: (filters?: { name: string; extensions: string[] }[]): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openFile', filters),

  /**
   * Load and parse a local JSON file. Returns { ok, data?, error? }
   */
  loadJsonFile: (filePath: string): Promise<{ ok: boolean; data?: unknown; path?: string; error?: string }> =>
    ipcRenderer.invoke('json:loadFile', filePath),

  /**
   * POST to Python FastAPI to process a PDF. Returns { ok, data?, error? }
   */
  processPdf: (pdfPath: string): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('pdf:process', pdfPath),

  /** Legacy IPC pass-through for any raw channel usage */
  on: (...args: Parameters<typeof ipcRenderer.on>) => {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...a) => listener(event, ...a))
  },
  off: (...args: Parameters<typeof ipcRenderer.off>) => {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
})
