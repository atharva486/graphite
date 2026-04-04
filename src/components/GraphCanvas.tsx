import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocStore } from '../store/useDocStore'
import { getNodeColor } from '../lib/parseDoclingJson'
import type { FGNode, FGLink } from '../types/docling'

// ─── Graph Canvas ─────────────────────────────────────────────────────────────
export function GraphCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<any>(null)
  const FGRef = useRef<any>(null)
  const [fgReady, setFgReady] = useState(false)
  const [size, setSize] = useState({ w: 800, h: 600 })

  const fgNodes = useDocStore(s => s.flowNodes)
  const fgLinks = useDocStore(s => s.flowEdges)
  const selectNode = useDocStore(s => s.selectNode)
  const selectedId = useDocStore(s => s.selectedNodeId)
  const status = useDocStore(s => s.status)

  // ── State debugging ────────────────────────────────────────────────────────
  useEffect(() => {
    console.log("🎨 [CANVAS DEBUG] State changed!")
    console.log("🎨   Status:", status)
    console.log("🎨   Nodes count:", fgNodes.length)
    console.log("🎨   Links count:", fgLinks.length)
  }, [status, fgNodes, fgLinks])

  // 👇 ── BRAND NEW: AI Engine Fetcher ──────────────────────────────────────── 👇
  useEffect(() => {
    if (!selectedId) return;

    console.log(`🖱️ [FRONTEND] Node ${selectedId} clicked! Asking AI Engine for suggestions...`);

    // NOTE: This is hardcoded to your test file for now. 
    // If you test a different PDF, update this path!
    const jsonPath = "/home/atharva/hackbyte/graphite/test_book_structure.json";

    fetch('http://localhost:8005/get-cards', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        node_id: selectedId,
        visited_ids: [], // We can wire this up to Zustand later!
        json_path: jsonPath
      })
    })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
      return response.json();
    })
    .then(data => {
      console.log("🧠 ================= AI SUGGESTIONS =================");
      console.log(data);
      console.log("=====================================================");
    })
    .catch(error => {
      console.error("❌ [AI API ERROR] Failed to reach the Python AI Engine:", error);
    });

  }, [selectedId]);
  // 👆 ──────────────────────────────────────────────────────────────────────── 👆

  // ── Lazy-load react-force-graph after mount ────────────────────────────────
  useEffect(() => {
    import('react-force-graph-2d').then(mod => {
      FGRef.current = mod.default
      setFgReady(true)
    }).catch(console.error)
  }, [])

  // ── Track container size ───────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setSize({ w: e.contentRect.width, h: e.contentRect.height })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Pan to selected node on sidebar click ─────────────────────────────────
  useEffect(() => {
    if (!selectedId || !fgRef.current) return
    const node = fgNodes.find(n => n.id === selectedId)
    if (!node || node.x == null) return
    fgRef.current.centerAt(node.x, node.y, 600)
    fgRef.current.zoom(2.5, 600)
  }, [selectedId, fgNodes])

  const handleNodeClick = useCallback(
    (node: FGNode) => selectNode(node.id === selectedId ? null : node.id),
    [selectNode, selectedId],
  )

  // ── Custom canvas node renderer ────────────────────────────────────────────
  const paintNode = useCallback(
    (node: FGNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isSelected = node.id === selectedId
      const color = getNodeColor(node.nodeType)
      const fontSize = Math.max(3, 12 / globalScale)
      const W = Math.max(60, Math.min(180, node.label.length * fontSize * 0.55))
      const H = fontSize * 3.4
      const x = (node.x ?? 0) - W / 2
      const y = (node.y ?? 0) - H / 2
      const r = 5 / globalScale

      // Rounded rect background
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(x + r, y); ctx.lineTo(x + W - r, y)
      ctx.quadraticCurveTo(x + W, y, x + W, y + r); ctx.lineTo(x + W, y + H - r)
      ctx.quadraticCurveTo(x + W, y + H, x + W - r, y + H); ctx.lineTo(x + r, y + H)
      ctx.quadraticCurveTo(x, y + H, x, y + H - r); ctx.lineTo(x, y + r)
      ctx.quadraticCurveTo(x, y, x + r, y)
      ctx.closePath()
      ctx.fillStyle = isSelected ? `${color}28` : 'rgba(14,14,28,0.93)'
      ctx.fill()
      ctx.strokeStyle = isSelected ? color : `${color}70`
      ctx.lineWidth = (isSelected ? 2 : 1) / globalScale
      ctx.stroke()
      ctx.restore()

      // Type badge
      if (globalScale > 0.4) {
        ctx.save()
        ctx.font = `bold ${fontSize * 0.68}px Inter,sans-serif`
        ctx.fillStyle = color
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(node.nodeType, node.x ?? 0, y + 2 / globalScale)
        ctx.restore()
      }

      // Title
      ctx.save()
      ctx.font = `${fontSize * 0.85}px Inter,sans-serif`
      ctx.fillStyle = isSelected ? '#fff' : '#c8c8e0'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const maxChars = Math.floor(W / (fontSize * 0.52))
      const label = node.label.length > maxChars ? node.label.slice(0, maxChars - 1) + '…' : node.label
      ctx.fillText(label, node.x ?? 0, node.y ?? 0)
      ctx.restore()

      // Page
      if (globalScale > 0.7) {
        ctx.save()
        ctx.font = `${fontSize * 0.62}px JetBrains Mono,monospace`
        ctx.fillStyle = 'rgba(130,130,170,0.65)'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(`p.${node.page}`, node.x ?? 0, y + H - 1 / globalScale)
        ctx.restore()
      }
    },
    [selectedId],
  )

  const paintHitArea = useCallback(
    (node: FGNode, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const fontSize = Math.max(3, 12 / globalScale)
      const W = Math.max(60, Math.min(180, node.label.length * fontSize * 0.55))
      const H = fontSize * 3.4
      ctx.fillStyle = color
      ctx.fillRect((node.x ?? 0) - W / 2, (node.y ?? 0) - H / 2, W, H)
    },
    [],
  )

  // ── Empty / loading states ─────────────────────────────────────────────────
  if (status === 'idle') {
    return (
      <div className="graph-empty">
        <div className="graph-empty-content">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <circle cx="12" cy="5" r="3" /><circle cx="4" cy="19" r="3" /><circle cx="20" cy="19" r="3" />
            <line x1="12" y1="8" x2="4" y2="16" /><line x1="12" y1="8" x2="20" y2="16" />
          </svg>
          <h2>Your Semantic Graph</h2>
          <p>Load a Docling JSON or use Stream PDF to build the graph in real-time.</p>
        </div>
      </div>
    )
  }

  if (status === 'loading' || status === 'processing') {
    return (
      <div className="graph-empty">
        <div className="graph-empty-content">
          <div className="spinner" />
          <p>Parsing document…</p>
        </div>
      </div>
    )
  }

  // ── Force graph canvas ─────────────────────────────────────────────────────
  const FG = FGRef.current
  return (
    <div ref={containerRef} className="graph-canvas" style={{ background: '#090912' }}>
      {fgReady && FG && size.w > 0 && (

        <FG
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={{ nodes: fgNodes, links: fgLinks }}
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={paintHitArea}
          nodeCanvasObjectMode={() => 'replace'}
          linkColor={(l: FGLink) => l.color ?? '#2a2a4a'}
          linkWidth={1.5}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          onNodeClick={handleNodeClick}
          onBackgroundClick={() => selectNode(null)}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          cooldownTicks={200}
          backgroundColor="#090912"
          enableZoomInteraction
          enablePanInteraction
        />
      )}
    </div>
  )
}