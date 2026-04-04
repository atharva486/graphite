import { useState, useCallback, useEffect } from 'react'
import { useDocStore } from '../store/useDocStore'
import type { DocNode } from '../types/docling'

// ─── Stream event types ────────────────────────────────────────────────────────
type StreamEvent =
  | { status: 'init';       tree: DocNode[];  message: string }
  | { status: 'processing'; range: [number, number]; message: string }
  | { status: 'enriched';   range: [number, number]; sub_headings: DocNode[] }
  | { status: 'complete';   message: string }
  | { status: 'error';      message: string }
  | { status: 'save_path';  path: string }
  | { status: 'saved';      path: string; size: string; total: number }

export function Toolbar() {
  const {
    status, statusMessage, scanProgress,
    loadFromJson, appendSubHeadings,
    setPdfPath, pdfPath,
    setStatus, setScanProgress,
  } = useDocStore()

  const [isScanning, setIsScanning]   = useState(false)
  const [outputDir,  setOutputDir]    = useState<string | null>(null)
  const [savedPath,  setSavedPath]    = useState<string | null>(null)

  // ── Open File (JSON or PDF) ────────────────────────────────────────────────
const handleOpenFile = useCallback(async () => {
    const filePath = await window.electronAPI.openFile()
    if (!filePath) return

    if (filePath.endsWith('.json')){

      setStatus('loading', 'Reading JSON…')
      
      const result = await window.electronAPI.loadJsonFile(filePath)
      
      if (result.ok && result.data) {
        loadFromJson(result.data, filePath)
      } else {
        setStatus('error', `Failed: ${result.error}`)
      }
    } 
    // 👇 --- ADD THIS BLOCK FOR PDF --- 👇
    else if (filePath.endsWith('.pdf')) {
      
      setPdfPath(filePath)
      
      // If you are tracking the saved path in your component, reset it here:
      // setSavedPath(null) 
      
      // Extract just the file name from the path to show in the UI
      const fileName = filePath.split(/[\\/]/).pop() 
      setStatus('ready', `PDF ready: ${fileName}`)
    }
    // 👆 ------------------------------ 👆

  }, [loadFromJson, setPdfPath, setStatus]) // <-- Note: if you uncomment setSavedPath, add it to this array!
  // ── Pick output folder ────────────────────────────────────────────────────
  const handlePickOutputDir = useCallback(async () => {
    const dir = await window.electronAPI.openFolder()
    if (dir) {
      setOutputDir(dir)
      setStatus('ready', `Save folder set: ${dir}`)
    }
  }, [setStatus])

  // ── Clear output folder (revert to default next-to-PDF behaviour) ─────────
  const handleClearOutputDir = useCallback(() => {
    setOutputDir(null)
    setStatus('ready', pdfPath
      ? `PDF ready: ${pdfPath.split('/').pop()}`
      : 'No file loaded'
    )
  }, [pdfPath, setStatus])

  // ── Load bundled s1.json demo ─────────────────────────────────────────────
  const handleLoadDemo = useCallback(async () => {
    setStatus('loading', 'Loading s1.json…')
    try {
      const res = await fetch('/s1.json')
      if (!res.ok) {throw new Error(`HTTP ${res.status}`)}
      const data = await res.json()
      loadFromJson(data, 's1.json')
    } catch (e) {
      setStatus('error', `Failed: ${(e as Error).message}`)
    }
  }, [loadFromJson, setStatus])

  // ── Stream Scan PDF → dynamic graph ───────────────────────────────────────
  const handleStreamScan = useCallback(async () => {
    if (!pdfPath || isScanning) return

    setIsScanning(true)
    setSavedPath(null)
    setScanProgress('')
    setStatus('processing', 'Connecting to streaming server…')

    // Clean up any stale listeners
    window.electronAPI.offStreamChunk()

    // Register chunk handler BEFORE starting the stream
    window.electronAPI.onStreamChunk((line: string) => {
      let event: StreamEvent
      try { event = JSON.parse(line) } catch { return }

      switch (event.status) {

        case 'init':
          loadFromJson(event.tree, pdfPath)
          setStatus('processing', `TOC loaded (${event.tree.length} chapters) — scanning…`)
          setScanProgress('Scanning page ranges…')
          break

        case 'processing':
          setScanProgress(`Scanning p.${event.range[0]}–${event.range[1]}…`)
          break

        case 'enriched':
          appendSubHeadings(event.range, event.sub_headings)
          setScanProgress(`+${event.sub_headings.length} headings  p.${event.range[0]}–${event.range[1]}`)
          break

        case 'save_path':
          setSavedPath(event.path)
          setScanProgress(`Will save → ${event.path.split('/').pop()}`)
          break

        case 'saved':
          setSavedPath(event.path)
          setScanProgress(`Saved ${event.size} → ${event.path.split('/').pop()}`)
          break

        case 'complete':
          setStatus('ready', 'Scan complete')
          setScanProgress('')
          setIsScanning(false)
          window.electronAPI.offStreamChunk()
          break

        case 'error':
          setStatus('error', event.message)
          setScanProgress('')
          setIsScanning(false)
          window.electronAPI.offStreamChunk()
          break
      }
    })

    // Kick off the stream — passes outputDir so main process knows where to save
    const result = await window.electronAPI.streamScanPdf(pdfPath, outputDir ?? undefined)

    if (!result.ok) {
      setStatus('error', `Stream error: ${result.error}`)
      setScanProgress('')
      setIsScanning(false)
      window.electronAPI.offStreamChunk()
    }
  }, [pdfPath, isScanning, outputDir, loadFromJson, appendSubHeadings, setStatus, setScanProgress])

  // Cleanup on unmount
  useEffect(() => () => { window.electronAPI.offStreamChunk() }, [])

  // ── Derived label for save folder button ──────────────────────────────────
  const outputDirLabel = outputDir
    ? outputDir.split('/').pop() ?? outputDir
    : 'Set save folder'

  const statusClass =
    status === 'ready'                              ? 'status--ready'
    : status === 'error'                            ? 'status--error'
    : status === 'loading' || status === 'processing' ? 'status--loading'
    : 'status--idle'

  return (
    <header className="toolbar">

      {/* Logo */}
      <div className="toolbar-brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="5"  r="3" fill="#7c3aed"/>
          <circle cx="4"  cy="19" r="3" fill="#2563eb"/>
          <circle cx="20" cy="19" r="3" fill="#0891b2"/>
          <line x1="12" y1="8" x2="4"  y2="16" stroke="#7c3aed" strokeWidth="2"/>
          <line x1="12" y1="8" x2="20" y2="16" stroke="#0891b2" strokeWidth="2"/>
        </svg>
        <span className="toolbar-logo-text">Graphite</span>
      </div>

      {/* Actions */}
      <div className="toolbar-actions">

        {/* Open file */}
        <button className="btn btn-primary" onClick={handleOpenFile}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          Open File
        </button>

        {/* Load demo */}
        <button className="btn btn-ghost" onClick={handleLoadDemo}
                title="Load bundled s1.json">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          Load s1.json
        </button>

        {/* Save folder picker */}
        <div className="btn-group">
          <button
            className={`btn ${outputDir ? 'btn-folder-set' : 'btn-ghost'}`}
            onClick={handlePickOutputDir}
            title={outputDir ? `Saving to: ${outputDir}` : 'Choose where to save JSON output'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1
                       2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            {outputDirLabel}
          </button>

          {/* Clear folder button — only shown when a folder is set */}
          {outputDir && (
            <button
              className="btn btn-ghost btn-icon"
              onClick={handleClearOutputDir}
              title="Clear — save next to PDF instead"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6"  y2="18"/>
                <line x1="6"  y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>

        {/* Stream Scan — main CTA */}
        <button
          className={`btn ${pdfPath ? 'btn-stream' : 'btn-secondary'}`}
          onClick={handleStreamScan}
          disabled={!pdfPath || isScanning}
          title={
            !pdfPath
              ? 'Open a PDF first'
              : outputDir
                ? `Scan and save to ${outputDir}`
                : 'Scan and save next to PDF'
          }
        >
          {isScanning ? (
            <>
              <span className="btn-spinner"/>
              Scanning…
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2">
                <path d="M5 3l14 9-14 9V3z"/>
              </svg>
              Stream PDF
            </>
          )}
        </button>
      </div>

      {/* Status bar */}
      <div className={`toolbar-status ${statusClass}`}>
        <span className="status-dot"/>
        <span className="status-text">{statusMessage}</span>

        {scanProgress && (
          <span className="scan-progress">{scanProgress}</span>
        )}

        {/* Saved path pill — shown after successful save */}
        {savedPath && !isScanning && (
          <span
            className="saved-path"
            title={savedPath}
            onClick={() => window.electronAPI.showItemInFolder?.(savedPath)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1
                       2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            {savedPath.split('/').pop()}
          </span>
        )}
      </div>

    </header>
  )
}