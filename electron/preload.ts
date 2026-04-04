import { ipcRenderer, contextBridge } from 'electron'

type StreamChunkHandler = (line: string) => void

// ─── Expose typed API to Renderer via contextBridge ───────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
  /** Open native file picker. Returns selected file path or null. */
  openFile: (filters?: { name: string; extensions: string[] }[]): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openFile', filters),

  /** Load and parse a local JSON file. */
  loadJsonFile: (filePath: string): Promise<{ ok: boolean; data?: unknown; path?: string; error?: string }> =>
    ipcRenderer.invoke('json:loadFile', filePath),

  /** Legacy: POST to Python FastAPI /process-pdf. */
  processPdf: (pdfPath: string): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('pdf:process', pdfPath),

  /**
   * Upload PDF to Python streaming server (:8002).
   * Stream chunks are delivered via onStreamChunk listener.
   * Returns { ok, error? } when the stream is fully consumed.
   */
  streamScanPdf: (pdfPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pdf:stream-scan', pdfPath),

  /** Subscribe to NDJSON lines from the active stream. */
  onStreamChunk: (handler: StreamChunkHandler) => {
    ipcRenderer.on('stream:chunk', (_event, line: string) => handler(line))
  },

  /** Unsubscribe all stream:chunk listeners. */
  offStreamChunk: () => {
    ipcRenderer.removeAllListeners('stream:chunk')
  },

  /** Legacy IPC pass-through */
  on: (...args: Parameters<typeof ipcRenderer.on>) => {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...a) => listener(event, ...a))
  },
  off: (...args: Parameters<typeof ipcRenderer.off>) => {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
})
