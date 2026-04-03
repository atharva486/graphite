import { useEffect, useRef } from 'react'
import { useDocStore } from '../store/useDocStore'

export function PdfViewer() {
  const { pdfPath, selectedNodeId, flowNodes } = useDocStore()
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Find selected node to get page/bbox info
  const selectedNode = selectedNodeId
    ? flowNodes.find((n) => n.id === selectedNodeId)
    : null
  const page = selectedNode?.data?.page ?? 1

  // When selection changes, try to navigate to the correct page
  useEffect(() => {
    if (iframeRef.current && pdfPath) {
      const url = `file://${pdfPath}#page=${page}`
      if (iframeRef.current.src !== url) {
        iframeRef.current.src = url
      }
    }
  }, [page, pdfPath])

  if (!pdfPath) {
    return (
      <aside className="pdf-viewer pdf-viewer--empty">
        <div className="pdf-viewer-header">
          <span>PDF Viewer</span>
        </div>
        <div className="pdf-viewer-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <p>No PDF loaded</p>
          <small>Open a PDF file to view it here alongside the graph</small>
        </div>
      </aside>
    )
  }

  return (
    <aside className="pdf-viewer">
      <div className="pdf-viewer-header">
        <span>PDF Viewer</span>
        {selectedNode && (
          <span className="pdf-viewer-badge">
            {selectedNode.data.label} · p.{page}
          </span>
        )}
      </div>
      <iframe
        ref={iframeRef}
        src={`file://${pdfPath}#page=${page}`}
        className="pdf-iframe"
        title="PDF Document"
      />
    </aside>
  )
}
