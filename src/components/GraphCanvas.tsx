import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { useDocStore } from '../store/useDocStore'

const TAU = Math.PI * 2
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

function hashToUnit(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

function shortestAngleDiff(a: number, b: number) {
  let d = b - a
  while (d > Math.PI) d -= TAU
  while (d < -Math.PI) d += TAU
  return d
}

// ─── Depth colour palette ────────────────────────────────────────────────────
const DEPTH_COLORS = [
  '#bf95f9',
  '#7c9ef8',
  '#5bbcf7',
  '#4ec9a0',
  '#f0c674',
  '#e06c75',
]
const DEPTH_LABELS = ['Chapter', 'Section', 'Subsection', 'Level 3', 'Level 4', 'Level 5']

function depthColor(depth: number) {
  return DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)]
}

// ─── Orbit radii ─────────────────────────────────────────────────────────────
const RING_RADII = [
  0,
  140,
  310,
  520,
  770,
  1060,
]

// Same-ring sibling spacing, measured as arc length in pixels.
// Smaller value = children stay closer together.
const SIBLING_ARC_GAP = 72

// Hard exclusion zone between nodes on different rings.
const CROSS_RING_GUARD = 34

export function GraphCanvas() {
  const fgNodes        = useDocStore(s => s.flowNodes)
  const fgEdges        = useDocStore(s => s.flowEdges)
  const selectNode     = useDocStore(s => s.selectNode)
  const status         = useDocStore(s => s.status)
  const selectedNodeId = useDocStore(s => s.selectedNodeId)

  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set())
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef     = useRef<any>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })

  // Keep node objects stable so ForceGraph retains x/y/vx/vy across rerenders.
  const nodeCacheRef = useRef<Map<string, any>>(new Map())
  const angleMemoryRef = useRef<Map<string, number>>(new Map())

  const maxDepth = useMemo(
    () => Math.max(...fgNodes.map(n => n.depth ?? 0), 1),
    [fgNodes]
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) setDimensions({ width: r.width, height: r.height })

    const ro = new ResizeObserver(es => {
      const { width, height } = es[0].contentRect
      if (width > 0 && height > 0) setDimensions({ width, height })
    })

    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const graphData = useMemo(() => {
    const liveIds = new Set(fgNodes.map(n => n.id))
    const cache = nodeCacheRef.current

    // Update cached nodes in place so physics state is preserved.
    for (const src of fgNodes) {
      const existing = cache.get(src.id)
      const node = existing ?? { ...src }
      Object.assign(node, src)
      cache.set(src.id, node)

      if (!angleMemoryRef.current.has(src.id)) {
        angleMemoryRef.current.set(src.id, hashToUnit(src.id) * TAU)
      }
    }

    const allNodes = Array.from(cache.values()).filter(n => liveIds.has(n.id))

    const parentOf = new Map<string, string>()
    fgEdges.forEach(e => {
      const s = typeof e.source === 'object' ? (e.source as any).id : String(e.source)
      const t = typeof e.target === 'object' ? (e.target as any).id : String(e.target)
      parentOf.set(t, s)
    })

    allNodes.forEach(n => {
      n._parentId = parentOf.get(n.id) ?? null
    })

    const childrenOf = new Map<string, string[]>()
    allNodes.forEach(n => {
      if (n._parentId) {
        if (!childrenOf.has(n._parentId)) childrenOf.set(n._parentId, [])
        childrenOf.get(n._parentId)!.push(n.id)
      }
    })

    // Stable target angle assignment.
    // Roots get deterministic angles. Children inherit a slot near their parent.
    const targetAngle = new Map<string, number>()

    const getAngle = (id: string) => {
      const n = cache.get(id)
      if (!n) return angleMemoryRef.current.get(id) ?? 0
      const x = n.x ?? 0
      const y = n.y ?? 0
      const cur = Math.atan2(y, x)
      if (Number.isFinite(cur)) return cur
      return angleMemoryRef.current.get(id) ?? hashToUnit(id) * TAU
    }

    const roots = allNodes
      .filter(n => !n._parentId)
      .sort((a, b) => String(a.label ?? a.id).localeCompare(String(b.label ?? b.id)))

    roots.forEach((root, i) => {
      const spread = roots.length > 1 ? 0.9 : 0
      const angle = -Math.PI / 2 + (i - (roots.length - 1) / 2) * spread
      targetAngle.set(root.id, angle)
      angleMemoryRef.current.set(root.id, angle)
    })

    const walk = (id: string) => {
      const parent = cache.get(id)
      if (!parent) return

      const parentAngle = targetAngle.get(id) ?? getAngle(id)
      const kids = (childrenOf.get(id) ?? [])
        .slice()
        .sort((a, b) => {
          const na = cache.get(a)
          const nb = cache.get(b)
          return String(na?.label ?? a).localeCompare(String(nb?.label ?? b))
        })

      if (!kids.length) return

      // Children stay fairly tight so the structure reads as a cluster,
      // not a fan explosion. The spread still scales with count.
      const span = clamp(0.34 + kids.length * 0.08, 0.34, 1.0)
      const step = kids.length > 1 ? span / (kids.length - 1) : 0

      kids.forEach((kidId, idx) => {
        const existing = targetAngle.get(kidId)
        const angle = existing ?? (parentAngle + (idx - (kids.length - 1) / 2) * step)
        targetAngle.set(kidId, angle)
        angleMemoryRef.current.set(kidId, angle)
        walk(kidId)
      })
    }

    roots.forEach(r => walk(r.id))

    allNodes.forEach(n => {
      const d = n.depth ?? 0
      n._targetRadius = RING_RADII[Math.min(d, RING_RADII.length - 1)]
      n._targetAngle = targetAngle.get(n.id) ?? angleMemoryRef.current.get(n.id) ?? 0
    })

    const visibleIds = new Set<string>()
    allNodes.forEach(n => {
      if ((n.depth ?? 0) <= 1) visibleIds.add(n.id)
    })

    const addAncestors = (id: string) => {
      let cur: string | undefined = id
      while (cur) {
        if (visibleIds.has(cur)) break
        visibleIds.add(cur)
        cur = parentOf.get(cur)
      }
    }

    expandedNodeIds.forEach(eid => {
      addAncestors(eid)
      visibleIds.add(eid)
      const children = childrenOf.get(eid) ?? []
      children.forEach(cid => visibleIds.add(cid))
    })

    if (selectedNodeId) addAncestors(selectedNodeId)

    const filteredNodes = allNodes.filter(n => visibleIds.has(n.id))

    const filteredLinks = fgEdges
      .filter(e => {
        const s = typeof e.source === 'object' ? (e.source as any).id : String(e.source)
        const t = typeof e.target === 'object' ? (e.target as any).id : String(e.target)
        return visibleIds.has(s) && visibleIds.has(t)
      })
      .map(e => ({ ...e }))

    return { nodes: filteredNodes, links: filteredLinks }
  }, [fgNodes, fgEdges, selectedNodeId, expandedNodeIds])

  useEffect(() => {
    const fg = graphRef.current
    if (!fg) return

    const nodes = graphData.nodes as any[]

    // Keep base link force very gentle. Rings should drive the layout.
    const linkF = fg.d3Force('link')
    if (linkF) {
      linkF.strength(0.01).distance(50)
    }

    fg.d3Force('charge', null)

    // Strong radial tether. This keeps rings clean.
    fg.d3Force('radial', (alpha: number) => {
      nodes.forEach((node: any) => {
        const nx = node.x ?? 0
        const ny = node.y ?? 0
        const depth = node.depth ?? 0

        if (depth === 0) {
          node.vx = (node.vx ?? 0) - nx * 0.55 * alpha
          node.vy = (node.vy ?? 0) - ny * 0.55 * alpha
          return
        }

        const targetR = RING_RADII[Math.min(depth, RING_RADII.length - 1)]
        const dist = Math.sqrt(nx * nx + ny * ny) || 1
        const diff = dist - targetR
        const strength = 0.72

        node.vx = (node.vx ?? 0) - (nx / dist) * diff * strength * alpha
        node.vy = (node.vy ?? 0) - (ny / dist) * diff * strength * alpha
      })
    })

    // Gentle angular tether toward a stable slot.
    fg.d3Force('angularTether', (alpha: number) => {
      nodes.forEach((node: any) => {
        const depth = node.depth ?? 0
        if (depth === 0) return

        const nx = node.x ?? 0
        const ny = node.y ?? 0
        const dist = Math.sqrt(nx * nx + ny * ny) || 1
        const curAngle = Math.atan2(ny, nx)
        const targetAngle = node._targetAngle ?? curAngle
        const d = shortestAngleDiff(curAngle, targetAngle)

        const tx = -Math.sin(curAngle)
        const ty = Math.cos(curAngle)

        const pull = clamp(Math.abs(d), 0, 1.2) * 0.11 * alpha
        const dir = d > 0 ? 1 : -1

        node.vx = (node.vx ?? 0) + tx * pull * dir
        node.vy = (node.vy ?? 0) + ty * pull * dir

        const desiredR = node._targetRadius ?? dist
        const radialFix = (desiredR - dist) * 0.01 * alpha
        node.vx = (node.vx ?? 0) + (nx / dist) * radialFix
        node.vy = (node.vy ?? 0) + (ny / dist) * radialFix
      })
    })

    // Same-ring spread only. Tangential push, not radial shoving.
    fg.d3Force('sameRingSpread', (alpha: number) => {
      const byDepth = new Map<number, any[]>()
      nodes.forEach(n => {
        const d = n.depth ?? 0
        if (!byDepth.has(d)) byDepth.set(d, [])
        byDepth.get(d)!.push(n)
      })

      byDepth.forEach(group => {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const a = group[i]
            const b = group[j]

            const ax = a.x ?? 0, ay = a.y ?? 0
            const bx = b.x ?? 0, by = b.y ?? 0

            const ra = Math.sqrt(ax * ax + ay * ay) || 1
            const rb = Math.sqrt(bx * bx + by * by) || 1
            const ta = Math.atan2(ay, ax)
            const tb = Math.atan2(by, bx)

            const arc = Math.abs(shortestAngleDiff(ta, tb)) * Math.min(ra, rb)
            const desired = SIBLING_ARC_GAP * Math.min(ra, rb)

            if (arc < desired) {
              const strength = ((desired - arc) / desired) * 0.22 * alpha
              const sign = shortestAngleDiff(ta, tb) > 0 ? 1 : -1

              const atx = -Math.sin(ta)
              const aty = Math.cos(ta)
              const btx = -Math.sin(tb)
              const bty = Math.cos(tb)

              a.vx = (a.vx ?? 0) - atx * strength * sign
              a.vy = (a.vy ?? 0) - aty * strength * sign
              b.vx = (b.vx ?? 0) + btx * strength * sign
              b.vy = (b.vy ?? 0) + bty * strength * sign
            }
          }
        }
      })
    })

    // Hard stop for ring bleeding.
    fg.d3Force('crossRingGuard', (alpha: number) => {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]
          const b = nodes[j]
          if ((a.depth ?? 0) === (b.depth ?? 0)) continue

          const ax = a.x ?? 0, ay = a.y ?? 0
          const bx = b.x ?? 0, by = b.y ?? 0
          const dx = bx - ax
          const dy = by - ay
          const d = Math.sqrt(dx * dx + dy * dy) || 1

          if (d < CROSS_RING_GUARD) {
            const magnitude = ((CROSS_RING_GUARD - d) / CROSS_RING_GUARD) * 0.22 * alpha
            const fx = (dx / d) * magnitude
            const fy = (dy / d) * magnitude
            a.vx = (a.vx ?? 0) - fx
            a.vy = (a.vy ?? 0) - fy
            b.vx = (b.vx ?? 0) + fx
            b.vy = (b.vy ?? 0) + fy
          }
        }
      }
    })

    const collideF = fg.d3Force('collide')
    if (collideF) {
      collideF
        .radius((n: any) => 7 + (maxDepth - (n.depth ?? 0)) * 1.8)
        .strength(0.85)
    }

    fg.d3ReheatSimulation?.()
  }, [graphData, maxDepth])

  // Seed newly expanded children near their parent, with a narrow arc.
  useEffect(() => {
    const fg = graphRef.current
    if (!fg || !expandedNodeIds.size) return
    const nodes = graphData.nodes as any[]

    expandedNodeIds.forEach(eid => {
      const parent = nodes.find((n: any) => n.id === eid)
      if (!parent) return

      const children = nodes.filter((n: any) => n._parentId === eid)
      if (!children.length) return

      const parentAngle = Math.atan2(parent.y ?? 0, parent.x ?? 0)
      const baseAngle = Number.isFinite(parentAngle) ? parentAngle : -Math.PI / 2

      // Keep expansion tight enough to read as a family, not a firework.
      const totalArc = Math.min(Math.PI * 0.24, 0.12 * children.length)
      const step = children.length > 1 ? totalArc / (children.length - 1) : 0

      children.forEach((child: any, idx: number) => {
        const cx = child.x ?? 0
        const cy = child.y ?? 0
        const alreadyPlaced = Math.sqrt(cx * cx + cy * cy) > 20
        if (alreadyPlaced) return

        const childDepth = child.depth ?? 0
        const targetR = RING_RADII[Math.min(childDepth, RING_RADII.length - 1)]
        const angle = baseAngle + (idx - (children.length - 1) / 2) * step

        child.x = Math.cos(angle) * targetR + (Math.random() - 0.5) * 8
        child.y = Math.sin(angle) * targetR + (Math.random() - 0.5) * 8
        child.vx = 0
        child.vy = 0
      })
    })

    fg.d3ReheatSimulation?.()
  }, [graphData, expandedNodeIds])

  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const nx = node.x
      const ny = node.y
      if (nx == null || ny == null || !isFinite(nx) || !isFinite(ny)) return

      const depth = node.depth ?? 0
      const isSelected = selectedNodeId === node.id
      const isExpanded = expandedNodeIds.has(node.id)
      const isHovered = hoveredNodeId === node.id
      const isActivated = isSelected || isExpanded
      const color = depthColor(depth)

      // --- UX Enhancement: Dim non-focused nodes ---
      let focusOpacity = 1
      if (selectedNodeId) {
        if (isSelected || isHovered) focusOpacity = 1
        else if (isExpanded) focusOpacity = 0.5   // Keep expanded lineage somewhat visible
        else focusOpacity = 0.15                  // Heavily dim unrelated nodes
      } else if (hoveredNodeId) {
        if (isHovered) focusOpacity = 1
        else focusOpacity = 0.35                  // Softly dim others on hover
      }

      ctx.save()
      ctx.globalAlpha = focusOpacity // Apply opacity to the entire node and text

      const baseR = 3.5 + (maxDepth - depth) * 2.2
      const r = isActivated ? baseR * 1.42 : baseR

      const haloR = r * (isSelected ? 3.2 : isExpanded ? 2.7 : isHovered ? 2.2 : 1.8)
      const grad = ctx.createRadialGradient(nx, ny, r * 0.25, nx, ny, haloR)
      const haloA = isSelected ? '66' : isExpanded ? '48' : isHovered ? '2d' : '18'
      grad.addColorStop(0, color + haloA)
      grad.addColorStop(1, color + '00')

      ctx.beginPath()
      ctx.arc(nx, ny, haloR, 0, TAU)
      ctx.fillStyle = grad
      ctx.fill()

      ctx.beginPath()
      ctx.arc(nx, ny, r, 0, TAU)
      ctx.fillStyle = isSelected ? '#ffffff' : color
      ctx.fill()

      if (isActivated || isHovered) {
        ctx.lineWidth = isSelected ? 2 : isHovered ? 1.35 : 1.15
        ctx.strokeStyle = isSelected ? '#ffffff' : color
        ctx.stroke()

        if (isExpanded && !isSelected) {
          ctx.beginPath()
          ctx.arc(nx, ny, r + 3.5, 0, TAU)
          ctx.lineWidth = 0.9
          ctx.strokeStyle = color + 'aa'
          ctx.stroke()
        }
      }

      const minScale = depth === 0 ? 0 : depth === 1 ? 0.42 : depth === 2 ? 0.95 : 1.55
      if (globalScale >= minScale || isActivated || isHovered) {
        const raw = (node.label || node.data?.label || '').trim()
        if (!raw) {
          ctx.restore()
          return
        }

        const maxChars = depth <= 1 ? 34 : 26
        const label = raw.length > maxChars ? raw.slice(0, maxChars - 1) + '…' : raw
        const fontSize = Math.max(9, (depth <= 1 ? 12 : 10) / globalScale)
        const fadeIn = Math.min(1, (globalScale - minScale + 0.35) / 0.35)
        
        // Removed the complex text alpha logic because globalAlpha handles it cleanly now
        const textAlpha = isHovered || isActivated ? 1 : fadeIn * (depth === 0 ? 0.95 : 0.72)

        ctx.save()
        ctx.font = `${isHovered ? 600 : depth <= 1 ? 500 : 400} ${fontSize}px -apple-system,"Segoe UI",sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.shadowColor = 'rgba(0,0,0,0.95)'
        ctx.shadowBlur = isHovered ? 10 : 6

        const [lr, lg, lb] = isSelected
          ? [235, 225, 255]
          : isExpanded
            ? [220, 215, 255]
            : isHovered
              ? [245, 242, 255]
              : depth === 0
                ? [210, 195, 255]
                : depth === 1
                  ? [195, 205, 255]
                  : [180, 178, 210]

        ctx.fillStyle = `rgba(${lr},${lg},${lb},${textAlpha})`
        ctx.fillText(label, nx, ny + r + 4)
        ctx.restore()
      }
      ctx.restore() // Restore the global opacity setting
    },
    [selectedNodeId, expandedNodeIds, hoveredNodeId, maxDepth]
  )

  const paintPointer = useCallback(
    (node: any, color: string, ctx: CanvasRenderingContext2D) => {
      const nx = node.x
      const ny = node.y
      if (nx == null || ny == null || !isFinite(nx) || !isFinite(ny)) return
      const r = 5 + (maxDepth - (node.depth ?? 0)) * 2.4 + 8
      ctx.beginPath()
      ctx.arc(nx, ny, r, 0, TAU)
      ctx.fillStyle = color
      ctx.fill()
    },
    [maxDepth]
  )

  const handleNodeClick = useCallback((n: any) => {
    setExpandedNodeIds(prev => {
      const next = new Set(prev)
      if (next.has(n.id)) next.delete(n.id)
      else next.add(n.id)
      return next
    })
    selectNode(n.id)
  }, [selectNode])

  const handleBackgroundClick = useCallback(() => selectNode(null), [selectNode])

  const linkColor = useCallback((link: any) => {
    const src = typeof link.source === 'object' ? link.source?.id : link.source
    const tgt = typeof link.target === 'object' ? link.target?.id : link.target

    const hasSelection = !!selectedNodeId
    const isSelectedLink = src === selectedNodeId || tgt === selectedNodeId
    const isHoveredLink = src === hoveredNodeId || tgt === hoveredNodeId
    const isExpandedLink = expandedNodeIds.has(src) || expandedNodeIds.has(tgt)

    // Highlight relationships connected directly to the user's focus
    if (isSelectedLink) return 'rgba(210, 195, 255, 0.85)'
    if (isHoveredLink) return 'rgba(210, 195, 255, 0.65)'
    if (isExpandedLink) return 'rgba(200, 185, 255, 0.4)'

    // Dim the remaining unrelated background noise
    if (hasSelection) return 'rgba(140, 130, 175, 0.05)'
    if (hoveredNodeId) return 'rgba(140, 130, 175, 0.08)'
    return 'rgba(140, 130, 175, 0.16)'
  }, [expandedNodeIds, selectedNodeId, hoveredNodeId])

  // Links between the same hierarchy feel cleaner if we render them with a mild bend.
  const linkCurvature = useCallback((link: any) => {
    const sDepth = link.source?.depth ?? 0
    const tDepth = link.target?.depth ?? 0
    if (sDepth === tDepth && sDepth > 0) return 0.18
    return 0
  }, [])

  const linkWidth = useCallback((link: any) => {
    const sDepth = link.source?.depth ?? 0
    const tDepth = link.target?.depth ?? 0
    return sDepth === tDepth ? 1.15 : 0.85
  }, [])

  if (status === 'idle') {
    return (
      <div className="graph-empty" style={{ background: '#0d0f12' }}>
        <div className="graph-empty-content">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none"
               stroke="#bf95f9" strokeWidth="1" opacity="0.45">
            <circle cx="12" cy="5" r="3" />
            <circle cx="4" cy="19" r="3" />
            <circle cx="20" cy="19" r="3" />
            <line x1="12" y1="8" x2="4" y2="16" />
            <line x1="12" y1="8" x2="20" y2="16" />
          </svg>
          <h2>Your Semantic Graph</h2>
          <p>Load a Docling JSON file to visualise the document structure.</p>
        </div>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="graph-empty" style={{ background: '#0d0f12' }}>
        <div className="graph-empty-content">
          <div className="spinner" />
          <p>Parsing document…</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="graph-canvas"
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: '400px',
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        background:
          'radial-gradient(circle at 50% 42%, rgba(95,74,143,0.16), rgba(13,15,18,0.96) 44%), #0d0f12',
      }}
    >
      <div style={{ position: 'absolute', inset: 0 }}>
        <ForceGraph2D
          ref={graphRef}
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData}
          nodeId="id"
          backgroundColor="#0d0f12"
          warmupTicks={0}
          cooldownTicks={Infinity}
          cooldownTime={Infinity}
          d3AlphaDecay={0.012}
          d3VelocityDecay={0.3}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkCurvature={linkCurvature}
          linkDirectionalArrowLength={0}
          linkDirectionalParticles={0}
          enableNodeDrag={true}
          onNodeClick={handleNodeClick}
          onBackgroundClick={handleBackgroundClick}
          onNodeHover={(node: any) => {
            setHoveredNodeId(node?.id ?? null)
            if (containerRef.current) {
              containerRef.current.style.cursor = node ? 'pointer' : 'default'
            }
          }}
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={paintPointer}
          nodeCanvasObjectMode={() => 'replace'}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 14,
          left: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          pointerEvents: 'none',
          background: 'rgba(10,12,16,0.34)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(190,170,255,0.08)',
          borderRadius: 12,
          padding: '10px 12px',
        }}
      >
        {DEPTH_COLORS
          .slice(0, Math.min(maxDepth + 1, DEPTH_COLORS.length))
          .map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div
                style={{
                  width: 7 + (maxDepth - i) * 1.4,
                  height: 7 + (maxDepth - i) * 1.4,
                  borderRadius: '50%',
                  background: c,
                  boxShadow: `0 0 6px ${c}88`,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 10.5,
                  color: 'rgba(190,180,220,0.58)',
                  fontFamily: '-apple-system,"Segoe UI",sans-serif',
                }}
              >
                {DEPTH_LABELS[i] ?? `Level ${i}`}
              </span>
            </div>
          ))}
      </div>

      {expandedNodeIds.size > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            maxWidth: 240,
            pointerEvents: 'none',
            background: 'rgba(10,12,16,0.34)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(190,170,255,0.08)',
            borderRadius: 12,
            padding: '10px 12px',
          }}
        >
          {Array.from(expandedNodeIds).map(id => {
            const node = graphData.nodes.find((n: any) => n.id === id) as any
            if (!node) return null
            const c = depthColor(node.depth ?? 0)
            const label = (node.label || node.data?.label || id).trim()

            return (
              <div
                key={id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  borderRadius: 8,
                  padding: '3px 0',
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: c,
                    boxShadow: `0 0 4px ${c}`,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 10.5,
                    color: 'rgba(220,214,240,0.82)',
                    fontFamily: '-apple-system,"Segoe UI",sans-serif',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {label.length > 28 ? label.slice(0, 27) + '…' : label}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}