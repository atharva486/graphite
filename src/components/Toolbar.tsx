import { useState, useCallback } from 'react'
import { useDocStore } from '../store/useDocStore'

declare global {
  interface Window {
    electronAPI: {
      openFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
      loadJsonFile: (path: string) => Promise<{ ok: boolean; data?: unknown; path?: string; error?: string }>
      processPdf: (path: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>
    }
  }
}

export function Toolbar() {
  const { status, statusMessage, loadFromJson, setPdfPath, pdfPath, setStatus } = useDocStore()
  const [isProcessing, setIsProcessing] = useState(false)

  const handleOpenFile = useCallback(async () => {
    const filePath = await window.electronAPI.openFile()
    if (!filePath) return

    if (filePath.endsWith('.json')) {
      setStatus('loading', 'Reading JSON file…')
      const result = await window.electronAPI.loadJsonFile(filePath)
      if (result.ok && result.data) {
        loadFromJson(result.data, filePath)
      } else {
        setStatus('error', `Failed to load: ${result.error}`)
      }
    } else if (filePath.endsWith('.pdf')) {
      setPdfPath(filePath)
      setStatus('ready', `PDF loaded: ${filePath.split('/').pop()}`)
    }
  }, [loadFromJson, setPdfPath, setStatus])

  const handleProcessPdf = useCallback(async () => {
    if (!pdfPath) return
    setIsProcessing(true)
    setStatus('processing', 'Sending PDF to Python engine…')
    try {
      const result = await window.electronAPI.processPdf(pdfPath)
      if (result.ok) {
        setStatus('ready', 'Python processing complete. Awaiting SpacetimeDB updates…')
      } else {
        setStatus('error', `Python error: ${result.error}`)
      }
    } finally {
      setIsProcessing(false)
    }
  }, [pdfPath, setStatus])

  const handleLoadDemo = useCallback(async () => {
    setStatus('loading', 'Loading s1.json…')
    try {
      const res = await fetch('/s1.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      loadFromJson(data, 's1.json')
    } catch (e) {
      setStatus('error', `Failed to load s1.json: ${(e as Error).message}`)
    }
  }, [loadFromJson, setStatus])

  const statusClass =
    status === 'ready' ? 'status--ready'
    : status === 'error' ? 'status--error'
    : status === 'loading' || status === 'processing' ? 'status--loading'
    : 'status--idle'

  return (
    <header className="toolbar">
      {/* Logo */}
      <div className="toolbar-brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="5" r="3" fill="#7c3aed"/>
          <circle cx="4" cy="19" r="3" fill="#2563eb"/>
          <circle cx="20" cy="19" r="3" fill="#0891b2"/>
          <line x1="12" y1="8" x2="4" y2="16" stroke="#7c3aed" strokeWidth="2"/>
          <line x1="12" y1="8" x2="20" y2="16" stroke="#0891b2" strokeWidth="2"/>
        </svg>
        <span className="toolbar-logo-text">Graphite</span>
      </div>

      {/* Actions */}
      <div className="toolbar-actions">
        <button className="btn btn-primary" onClick={handleOpenFile}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          Open File
        </button>

        <button className="btn btn-ghost" onClick={handleLoadDemo} title="Load bundled s1.json">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="12" y2="18"/><line x1="15" y1="15" x2="12" y2="18"/>
          </svg>
          Load s1.json
        </button>

        <button
          className="btn btn-secondary"
          onClick={handleProcessPdf}
          disabled={!pdfPath || isProcessing}
        >
          {isProcessing ? (
            <span className="btn-spinner" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          )}
          Process PDF
        </button>
      </div>

      {/* Status */}
      <div className={`toolbar-status ${statusClass}`}>
        <span className="status-dot" />
        <span className="status-text">{statusMessage}</span>
      </div>
    </header>
  )
}
