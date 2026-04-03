/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, exposed via contextBridge in `preload.ts`
interface Window {
  electronAPI: {
    openFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
    loadJsonFile: (path: string) => Promise<{ ok: boolean; data?: unknown; path?: string; error?: string }>
    processPdf: (path: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>
    on: (...args: any[]) => void
    off: (...args: any[]) => void
  }
}
