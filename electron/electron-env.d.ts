/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, exposed via contextBridge in `preload.ts`
interface Window {
  electronAPI: {
    openFile: (
      filters?: { name: string; extensions: string[] }[]
    ) => Promise<string | null>

    loadJsonFile: (
      filePath: string
    ) => Promise<{ ok: boolean; data?: unknown; path?: string; error?: string }>

    processPdf: (
      pdfPath: string
    ) => Promise<{ ok: boolean; data?: unknown; error?: string }>

    streamScanPdf: (
      pdfPath: string,
      outputDir?: string                              // ← added
    ) => Promise<{ ok: boolean; savedTo?: string; error?: string }>  // ← savedTo added

    onStreamChunk:    (handler: (line: string) => void) => void
    offStreamChunk:   () => void

    openFolder:       () => Promise<string | null>    // ← added
    showItemInFolder?: (filePath: string) => Promise<void>  // ← added (optional so existing call sites don't break)

    on:  (...args: any[]) => void
    off: (...args: any[]) => void
  }
}