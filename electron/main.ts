import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1024,
    minHeight: 640,
    title: 'Graphite — Semantic Graph Explorer',
    backgroundColor: '#0d0d0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // allow local file:// for PDF viewer
    },
  })

  win.maximize()

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date()).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

/** Open a native file picker for JSON or PDF */
ipcMain.handle('dialog:openFile', async (_event, filters?: { name: string; extensions: string[] }[]) => {
  const defaultFilters = filters ?? [
    { name: 'Supported Files', extensions: ['json', 'pdf'] },
    { name: 'JSON', extensions: ['json'] },
    { name: 'PDF', extensions: ['pdf'] },
  ]
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: defaultFilters,
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

/** Read a JSON file and return parsed object */
ipcMain.handle('json:loadFile', async (_event, filePath: string) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return { ok: true, data: JSON.parse(raw), path: filePath }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

/** POST to Python FastAPI /process-pdf — returns job status */
ipcMain.handle('pdf:process', async (_event, pdfPath: string) => {
  try {
    // Dynamic import to avoid ESM issues with node-fetch alternatives
    const response = await fetch('http://localhost:8000/process-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: pdfPath }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

// ─── App lifecycle ─────────────────────────────────────────────────────────────

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(createWindow)
