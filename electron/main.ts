import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'  // ← shell added
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

const SERVER_URL = 'https://incurred-supply-entering-strange.trycloudflare.com/stream-scan'

let win: BrowserWindow | null

// ─── Tree helpers ─────────────────────────────────────────────────────────────

interface DocNode {
  title: string
  page: number
  page_range?: [number, number]
  children?: DocNode[]
}

function collectAllPages(nodes: DocNode[]): number[] {
  const pages: number[] = []
  for (const node of nodes) {
    pages.push(node.page)
    if (node.children?.length) pages.push(...collectAllPages(node.children))
  }
  return pages
}

function attachPageRanges(nodes: DocNode[], allPages: number[], totalPages: number): void {
  for (const node of nodes) {
    if (node.children?.length) {
      attachPageRanges(node.children, allPages, totalPages)
    } else {
      const start = node.page
      const later = allPages.filter(p => p > start).sort((a, b) => a - b)
      node.page_range = [start, later.length > 0 ? later[0] - 1 : totalPages]
    }
  }
}

function findLeafByRange(nodes: DocNode[], start: number, end: number): DocNode | null {
  for (const node of nodes) {
    if (!node.children?.length) {
      const pr = node.page_range
      if (pr && pr[0] === start && pr[1] === end) return node
    } else {
      const found = findLeafByRange(node.children, start, end)
      if (found) return found
    }
  }
  return null
}

function resolveOutputPath(pdfPath: string, outputArg?: string | null): string {
  const baseName = path.basename(pdfPath, path.extname(pdfPath))
  const jsonName = `${baseName}_structure.json`
  if (outputArg) {
    if (fs.existsSync(outputArg) && fs.statSync(outputArg).isDirectory())
      return path.join(outputArg, jsonName)
    return outputArg
  }
  return path.join(path.dirname(path.resolve(pdfPath)), jsonName)
}

// ─── Window ───────────────────────────────────────────────────────────────────

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
      webSecurity: false,
    },
  })

  win.maximize()

  // ── Open DevTools to capture errors ──
  win.webContents.openDevTools()

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // ── Log renderer crashes ──────────────────────────────────────────────────
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[MAIN] Renderer gone:', details.reason, details.exitCode)
  })

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[MAIN] did-fail-load:', code, desc)
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// ─── IPC: Open file ───────────────────────────────────────────────────────────

ipcMain.handle('dialog:openFile', async (_event, filters?: { name: string; extensions: string[] }[]) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: filters ?? [
      { name: 'Supported Files', extensions: ['json', 'pdf'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'PDF', extensions: ['pdf'] },
    ],
  })
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0]
})

// ─── IPC: Open folder ─────────────────────────────────────────────────────────

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose folder to save JSON output',
  })
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0]
})

// ─── IPC: Load JSON ───────────────────────────────────────────────────────────

ipcMain.handle('json:loadFile', async (_event, filePath: string) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return { ok: true, data: JSON.parse(raw), path: filePath }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})



// ─── IPC: Show file in OS file manager ───────────────────────────────────────
// ← THIS WAS MISSING — caused unhandled IPC rejection → blank screen

ipcMain.handle('shell:showItemInFolder', (_event, filePath: string) => {
  shell.showItemInFolder(filePath)
})

// ─── IPC: Stream scan ─────────────────────────────────────────────────────────

ipcMain.handle('pdf:stream-scan', async (event, pdfPath: string, outputDir?: string) => {
  try {
    const fileBuffer = fs.readFileSync(pdfPath)
    const fileName = path.basename(pdfPath)
    const outputPath = resolveOutputPath(pdfPath, outputDir)

    fs.mkdirSync(path.dirname(outputPath), { recursive: true })

    event.sender.send('stream:chunk', JSON.stringify({
      status: 'save_path',
      path: outputPath,
    }))

    const blob = new Blob([fileBuffer], { type: 'application/pdf' })
    const form = new FormData()
    form.append('file', blob, fileName)

    const response = await fetch(SERVER_URL, {
      method: 'POST',
      body: form as unknown as BodyInit,
    })

    if (!response.ok) {
      const errText = await response.text()
      return { ok: false, error: `Server ${response.status}: ${errText}` }
    }

    if (!response.body) return { ok: false, error: 'No response body' }

    let tree: DocNode[] | null = null
    let totalEnriched = 0
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        event.sender.send('stream:chunk', trimmed)

        let data: any
        try { data = JSON.parse(trimmed) } catch { continue }

        if (data.status === 'init') {
          tree = data.tree as DocNode[]
          const allPages = [...new Set(collectAllPages(tree))].sort((a, b) => a - b)
          const totalPages = allPages.length > 0 ? Math.max(...allPages) : 0
          attachPageRanges(tree, allPages, totalPages)

        } else if (data.status === 'enriched' && tree) {
          const [start, end] = data.range as [number, number]
          const leaf = findLeafByRange(tree, start, end)
          if (leaf) {
            leaf.children = data.sub_headings as DocNode[]
            totalEnriched += leaf.children.length
          }

        } else if (data.status === 'complete' && tree) {
          fs.writeFileSync(outputPath, JSON.stringify(tree, null, 2), 'utf-8')
          const sizeKb = (fs.statSync(outputPath).size / 1024).toFixed(1)
          event.sender.send('stream:chunk', JSON.stringify({
            status: 'saved',
            path: outputPath,
            size: `${sizeKb} KB`,
            total: totalEnriched,
          }))
        }
      }
    }

    if (buffer.trim()) event.sender.send('stream:chunk', buffer.trim())

    return { ok: true, savedTo: outputPath }

  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

// ─── IPC: Legacy REST ─────────────────────────────────────────────────────────

ipcMain.handle('pdf:process', async (_event, pdfPath: string) => {
  try {
    const response = await fetch('http://localhost:8000/process-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: pdfPath }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return { ok: true, data: await response.json() }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

// ─── App lifecycle ─────────────────────────────────────────────────────────────

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { app.quit(); win = null }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.whenReady().then(createWindow)