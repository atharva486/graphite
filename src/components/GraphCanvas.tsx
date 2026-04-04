import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { useDocStore } from '../store/useDocStore'

const TAU = Math.PI * 2

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
  220,
  480,
  780,
  1120,
  1500,
]

export function GraphCanvas() {
  const fgNodes        = useDocStore(s => s.flowNodes)
  const fgEdges        = useDocStore(s => s.flowEdges)
  const manualNodes    = useDocStore(s => s.manualNodes)
  const addManualNode  = useDocStore(s => s.addManualNode)
  const updateManualNode = useDocStore(s => s.updateManualNode)
  const deleteManualNode = useDocStore(s => s.deleteManualNode)
  const selectNode     = useDocStore(s => s.selectNode)
  const status         = useDocStore(s => s.status)
  const selectedNodeId = useDocStore(s => s.selectedNodeId)

  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set())
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'canvas' | 'node'; nodeId?: string } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef     = useRef<any>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })

  const nodeCacheRef = useRef<Map<string, any>>(new Map())

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

    for (const src of fgNodes) {
      let node = cache.get(src.id)
      if (!node) {
        node = { ...src, __hasBeenDragged: false }
        cache.set(src.id, node)
      } else {
        // Preserve drag state across component updates (e.g., expanding nodes)
        const savedFx = node.fx
        const savedFy = node.fy
        const savedDragged = node.__hasBeenDragged
        Object.assign(node, src)
        node.fx = savedFx
        node.fy = savedFy
        node.__hasBeenDragged = savedDragged
      }
    }

    // Convert manual nodes to FGNode format
    manualNodes.forEach(mn => {
      const node = cache.get(mn.id)
      if (!node) {
        const newNode = {
          id: mn.id,
          label: mn.label,
          nodeType: 'manual' as any,
          depth: 0,
          page: 0,
          page_range: [0, 0] as [number, number],
          docNode: {} as any, // placeholder
          isSelected: false,
          __hasBeenDragged: false,
        }
        cache.set(mn.id, newNode)
      } else {
        // Update existing
        node.label = mn.label
      }
    })

    const allNodes = Array.from(cache.values()).filter(n => liveIds.has(n.id) || manualNodes.some(mn => mn.id === n.id))

    // Build hierarchy
    const parentOf = new Map<string, string>()
    fgEdges.forEach(e => {
      const s = typeof e.source === 'object' ? (e.source as any).id : String(e.source)
      const t = typeof e.target === 'object' ? (e.target as any).id : String(e.target)
      parentOf.set(t, s)
    })

    // Add manual node edges
    manualNodes.forEach(mn => {
      mn.parents.forEach(parentId => {
        parentOf.set(mn.id, parentId)
      })
    })

    const childrenOf = new Map<string, string[]>()
    allNodes.forEach(n => {
      n._parentId = parentOf.get(n.id) ?? null
      if (n._parentId) {
        if (!childrenOf.has(n._parentId)) childrenOf.set(n._parentId, [])
        childrenOf.get(n._parentId)!.push(n.id)
      }
    })

    // Mark nodes that have children
    allNodes.forEach(n => {
      n.hasChildren = (childrenOf.get(n.id) || []).length > 0
    })

    // Assign reading order relative to parent (starts at 1 for each group of children)
    const assignReadingOrder = (id: string, index: number): void => {
      const node = cache.get(id)
      if (node) {
        node._readingOrder = index
      }
      const kids = childrenOf.get(id) ?? []
      let childIndex = 1
      for (const kid of kids) {
        assignReadingOrder(kid, childIndex++)
      }
    }

    const roots = allNodes.filter(n => !n._parentId)
    
    // Do depth-first reading order assignment starting with the roots
    let rootIndex = 1
    roots.forEach(r => assignReadingOrder(r.id, rootIndex++))
    
    if (roots.length > 0) {
      roots[0].__isRingDrawer = true
    }

    // Mathematical arc calculation for default positions
    const weight = new Map<string, number>()
    const calcWeight = (id: string) => {
      const kids = childrenOf.get(id) || []
      if (kids.length === 0) {
        weight.set(id, 1)
        return 1
      }
      let w = 0
      for (const k of kids) w += calcWeight(k)
      weight.set(id, w)
      return w
    }
    roots.forEach(r => calcWeight(r.id))
    const totalWeight = roots.reduce((sum, r) => sum + (weight.get(r.id) || 1), 0)

    const targetAngle = new Map<string, number>()
    const assignAngles = (id: string, startAngle: number, endAngle: number) => {
      const w = weight.get(id) || 1
      const midAngle = startAngle + (endAngle - startAngle) / 2
      targetAngle.set(id, midAngle)

      const kids = childrenOf.get(id) || []
      let currentStart = startAngle
      for (const k of kids) {
        const kw = weight.get(k) || 1
        const slice = (kw / w) * (endAngle - startAngle)
        assignAngles(k, currentStart, currentStart + slice)
        currentStart += slice
      }
    }

    let currentRootStart = -Math.PI / 2
    roots.forEach(r => {
      const w = weight.get(r.id) || 1
      const slice = (totalWeight > 0 ? (w / totalWeight) : 1 / roots.length) * TAU
      assignAngles(r.id, currentRootStart, currentRootStart + slice)
      currentRootStart += slice
    })

    // Assign positions. If they haven't been dragged, lock them to the math angle.
    allNodes.forEach(n => {
      const isManual = n.nodeType === 'manual'
      if (isManual) {
        // Manual nodes are free-floating, don't constrain to rings
        n._dragRadius = 0
        // Use stored position from manual node if available
        const manualNode = manualNodes.find(mn => mn.id === n.id)
        if (manualNode?.x != null && manualNode?.y != null) {
          n.x = manualNode.x
          n.y = manualNode.y
        } else if (n.x == null || n.y == null) {
          // Set default position if none exists
          n.x = Math.random() * 400 - 200
          n.y = Math.random() * 400 - 200
        }
      } else {
        const d = n.depth ?? 0
        const targetR = RING_RADII[Math.min(d, RING_RADII.length - 1)]
        const radiusToUse = d === 0 ? 0 : targetR
        
        n._dragRadius = radiusToUse 

        const angle = targetAngle.get(n.id) ?? 0
        n.x = radiusToUse * Math.cos(angle)
        n.y = radiusToUse * Math.sin(angle)
      }
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
    
    // Create edges for manual nodes
    const manualEdges = manualNodes.flatMap(mn => 
      mn.parents.map(parentId => ({
        source: parentId,
        target: mn.id,
      }))
    )
    
    const filteredLinks = [...fgEdges, ...manualEdges]
      .filter(e => {
        const s = typeof e.source === 'object' ? (e.source as any).id : String(e.source)
        const t = typeof e.target === 'object' ? (e.target as any).id : String(e.target)
        return visibleIds.has(s) && visibleIds.has(t)
      })
      .map(e => ({ ...e }))

    return { nodes: filteredNodes, links: filteredLinks }
  }, [fgNodes, fgEdges, manualNodes, selectedNodeId, expandedNodeIds])

  const activeLineageIds = useMemo(() => {
    const ids = new Set<string>()
    if (!hoveredNodeId) return ids

    const nodes = graphData.nodes as any[]
    const nodeMap = new Map(nodes.map(n => [n.id, n]))

    let currentId: string | null = hoveredNodeId
    while (currentId) {
      ids.add(currentId)
      const node = nodeMap.get(currentId)
      currentId = node?._parentId ?? null
    }

    return ids
  }, [hoveredNodeId, graphData.nodes])

  useEffect(() => {
    const fg = graphRef.current
    if (!fg) return

    const nodes = graphData.nodes as any[]

    fg.d3Force('charge', null)
    fg.d3Force('link', null)
    fg.d3Force('center', null)

    fg.d3Force('radialLock', (alpha: number) => {
      nodes.forEach((node: any) => {
        const isManual = node.nodeType === 'manual'
        if (isManual) return // Manual nodes are free-floating
        
        const nx = node.x ?? 0
        const ny = node.y ?? 0
        const depth = node.depth ?? 0
        const targetR = depth === 0 ? 0 : RING_RADII[Math.min(depth, RING_RADII.length - 1)]
        const dist = Math.sqrt(nx * nx + ny * ny) || 1
        const diff = targetR - dist
        const strength = 1.6 * alpha  // Strong orbit locking
        node.vx += (nx / dist) * diff * strength
        node.vy += (ny / dist) * diff * strength
      })
    })

    fg.d3Force('sameLevelRepel', (alpha: number) => {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]
          const b = nodes[j]
          if (a.depth !== b.depth) continue

          const dx = (b.x ?? 0) - (a.x ?? 0)
          const dy = (b.y ?? 0) - (a.y ?? 0)
          const d2 = dx * dx + dy * dy || 1
          const d = Math.sqrt(d2)
          const sameParent = a._parentId === b._parentId
          const baseStrength = sameParent ? 60 : 90
          const repulsionStrength = baseStrength * alpha / d2
          const fx = (dx / d) * repulsionStrength
          const fy = (dy / d) * repulsionStrength
          a.vx -= fx
          a.vy -= fy
          b.vx += fx
          b.vy += fy
        }
      }
    })

    fg.d3Force('manualNodeAttraction', (alpha: number) => {
      nodes.forEach((node: any) => {
        const isManual = node.nodeType === 'manual'
        if (!isManual) return

        // Find parent nodes
        const parentIds = manualNodes.find(mn => mn.id === node.id)?.parents || []
        if (parentIds.length === 0) return

        parentIds.forEach(parentId => {
          const parentNode = nodes.find(n => n.id === parentId)
          if (!parentNode) return

          const dx = (parentNode.x ?? 0) - (node.x ?? 0)
          const dy = (parentNode.y ?? 0) - (node.y ?? 0)
          const d2 = dx * dx + dy * dy || 1
          const d = Math.sqrt(d2)
          
          // Attractive force towards parent
          const attractionStrength = 0.5 * alpha / d2
          const fx = (dx / d) * attractionStrength
          const fy = (dy / d) * attractionStrength
          
          node.vx += fx
          node.vy += fy
        })
      })
    })

    fg.d3ReheatSimulation?.()
  }, [graphData])

  // ─── Custom Rail Drag Handlers ───────────────────────────────────────────────
  const handleNodeDrag = useCallback((node: any) => {
    node.__hasBeenDragged = true
    const isManual = node.nodeType === 'manual'
    if (isManual) {
      // Manual nodes can be dragged freely
      return
    }
    
    const r = node._dragRadius ?? 0
    if (r === 0) {
      node.x = 0
      node.y = 0
      node.fx = 0
      node.fy = 0
      return
    }
    // Calculate the angle based on where the user pulled the node
    const angle = Math.atan2(node.y, node.x)
    // Snap the node's position to that angle on its specific ring
    node.x = r * Math.cos(angle)
    node.y = r * Math.sin(angle)
    node.fx = node.x
    node.fy = node.y
  }, [])

  const handleNodeDragEnd = useCallback((node: any) => {
    node.__hasBeenDragged = true
    const isManual = node.nodeType === 'manual'
    if (isManual) {
      // Save the position for manual nodes
      updateManualNode(node.id, { x: node.x, y: node.y })
      return
    }
    
    const r = node._dragRadius ?? 0
    if (r === 0) {
      node.x = 0
      node.y = 0
      node.fx = 0
      node.fy = 0
      return
    }
    const angle = Math.atan2(node.y, node.x)
    node.x = r * Math.cos(angle)
    node.y = r * Math.sin(angle)
    node.fx = node.x
    node.fy = node.y
  }, [updateManualNode])

  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const nx = node.x
      const ny = node.y
      if (nx == null || ny == null || !isFinite(nx) || !isFinite(ny)) return

      if (node.__isRingDrawer) {
        ctx.save()
        ctx.strokeStyle = 'rgba(190, 180, 220, 0.12)'
        ctx.lineWidth = 1.5 / globalScale
        for (let i = 1; i <= maxDepth; i++) {
          const radius = RING_RADII[Math.min(i, RING_RADII.length - 1)]
          if (radius) {
            ctx.beginPath()
            ctx.arc(0, 0, radius, 0, TAU)
            ctx.stroke()
          }
        }

        ctx.restore()
      }

      const depth = node.depth ?? 0
      const isSelected = selectedNodeId === node.id
      const isExpanded = expandedNodeIds.has(node.id) && node.hasChildren
      const isHovered = hoveredNodeId === node.id
      const inHoverLineage = activeLineageIds.has(node.id)
      const isActivated = isSelected || isExpanded
      const isManual = node.nodeType === 'manual'
      const isConnecting = connectingFrom === node.id
      const color = isManual ? '#ff6b6b' : depthColor(depth)

      let focusOpacity = 1
      if (hoveredNodeId) {
        focusOpacity = inHoverLineage ? 1 : 0.12
      }

      ctx.save()
      ctx.globalAlpha = focusOpacity

      const baseR = 3.5 + (maxDepth - depth) * 2.2
      const r = isActivated ? baseR * 1.42 : isConnecting ? baseR * 1.8 : baseR

      const haloR = r * (isSelected ? 3.2 : isExpanded ? 2.7 : isHovered ? 2.2 : isConnecting ? 2.5 : 1.8)
      const grad = ctx.createRadialGradient(nx, ny, r * 0.25, nx, ny, haloR)
      const haloA = isSelected ? '66' : isExpanded ? '48' : isHovered ? '2d' : isConnecting ? '4d' : '18'
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

      // Draw reading order number perfectly inside the centre of the node
      if (node._readingOrder != null) {
        ctx.save()
        ctx.font = `600 ${Math.max(7, 8 / globalScale)}px monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = 'rgba(0,0,0,0.6)'
        ctx.fillText(String(node._readingOrder), nx, ny)
        ctx.restore()
      }

      const minScale = depth === 0 ? 0 : depth === 1 ? 0.3 : depth === 2 ? 0.7 : 1.2
      if (globalScale >= minScale || isActivated || inHoverLineage) {
        const raw = (node.label || node.data?.label || '').trim()
        if (!raw) {
          ctx.restore()
          return
        }

        // Maximum 16 characters unless highlighted/hovered
        const isTextHighlighted = inHoverLineage || isActivated
        const maxChars = 16
        const label = (!isTextHighlighted && raw.length > maxChars)
          ? raw.slice(0, maxChars - 1) + '…'
          : raw

        const fontSize = Math.max(9, (depth <= 1 ? 12 : 10) / globalScale)
        const fadeIn = Math.min(1, (globalScale - minScale + 0.35) / 0.35)
        
        const textAlpha = isTextHighlighted ? 1 : fadeIn * (depth === 0 ? 0.95 : 0.72)

        ctx.save()
        ctx.font = `${inHoverLineage ? 600 : depth <= 1 ? 500 : 400} ${fontSize}px -apple-system,"Segoe UI",sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.shadowColor = 'rgba(0,0,0,0.95)'
        ctx.shadowBlur = inHoverLineage ? 10 : 6

        const [lr, lg, lb] = isSelected
          ? [235, 225, 255]
          : isExpanded
            ? [220, 215, 255]
            : inHoverLineage
              ? [245, 242, 255]
              : depth === 0
                ? [210, 195, 255]
                : depth === 1
                  ? [195, 205, 255]
                  : [180, 178, 210]

        ctx.fillStyle = `rgba(${lr},${lg},${lb},${textAlpha})`
        ctx.fillText(label, nx, ny + r + 6)
        ctx.restore()
      }
      ctx.restore() 
    },
    [selectedNodeId, expandedNodeIds, hoveredNodeId, activeLineageIds, maxDepth, graphData]
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

  // Check if targetId is a descendant of sourceId (traverses manual node hierarchy)
  const isDescendantOf = useCallback((sourceId: string, targetId: string): boolean => {
    const visited = new Set<string>()

    const traverse = (nodeId: string): boolean => {
      if (visited.has(nodeId)) return false
      visited.add(nodeId)

      if (nodeId === targetId) return true

      const node = manualNodes.find(mn => mn.id === nodeId)
      if (!node) return false

      // Recursively check all ancestors (parents and their parents)
      for (const parentId of node.parents) {
        if (traverse(parentId)) return true
      }

      return false
    }

    return traverse(sourceId)
  }, [manualNodes])

  const handleNodeClick = useCallback((n: any, event?: any) => {
    const isManual = n.nodeType === 'manual'
    const isShiftPressed = event?.shiftKey

    if (connectingFrom) {
      // In connection mode - connect to this node
      if (connectingFrom !== n.id) {
        const manualNode = manualNodes.find(mn => mn.id === connectingFrom)
        if (manualNode && !manualNode.parents.includes(n.id)) {
          // Check for cycles: n.id cannot be a descendant of connectingFrom
          if (isDescendantOf(n.id, connectingFrom)) {
            console.warn('Cannot connect: would create a cycle')
            setConnectingFrom(null)
            return
          }

          // Add this node as parent to the connecting manual node
          updateManualNode(connectingFrom, {
            parents: [...manualNode.parents, n.id],
            isLinked: false  // Mark as linked now
          })
        }
      }
      setConnectingFrom(null)
      return
    }

    if (isManual && isShiftPressed) {
      // Only allow shift-click if node is not already linked
      const manualNode = manualNodes.find(mn => mn.id === n.id)
      if (manualNode && !manualNode.isLinked) {
        console.warn('This node is already linked and cannot be connected to another parent')
        return
      }
      // Start connection mode
      setConnectingFrom(n.id)
      return
    }

    if (n.hasChildren) {
      setExpandedNodeIds(prev => {
        const next = new Set(prev)
        if (next.has(n.id)) next.delete(n.id)
        else next.add(n.id)
        return next
      })
    }
    selectNode(n.id)
  }, [selectNode, connectingFrom, manualNodes, updateManualNode, isDescendantOf])

  const handleBackgroundClick = useCallback(() => {
    selectNode(null)
    setConnectingFrom(null)
    setContextMenu(null)
  }, [selectNode])

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      setContextMenu({ x, y, type: 'canvas' })
    }
  }, [])

  const handleNodeRightClick = useCallback((node: any, event: any) => {
    event.preventDefault()
    const isManual = node.nodeType === 'manual'
    if (isManual) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top
        setContextMenu({ x, y, type: 'node', nodeId: node.id })
      }
    }
  }, [])

  const handleAddManualNode = useCallback((x?: number, y?: number) => {
    const id = `manual-${Date.now()}`
    const label = `Manual Node ${manualNodes.length + 1}`
    const path = `user-notes/${id}.md`
    const node = {
      id,
      parents: [],
      path,
      label,
      x, // Store initial position
      y,
      isLinked: true,  // Newly created nodes can be linked
    }
    addManualNode(node)
    setContextMenu(null) // Close context menu
  }, [manualNodes.length, addManualNode])

  const handleDeleteManualNode = useCallback((nodeId: string) => {
    deleteManualNode(nodeId)
    setContextMenu(null)
  }, [deleteManualNode])

  const linkColor = useCallback((link: any) => {
    const src = typeof link.source === 'object' ? link.source?.id : link.source
    const tgt = typeof link.target === 'object' ? link.target?.id : link.target

    if (hoveredNodeId) {
      const isLineageLink = activeLineageIds.has(src) && activeLineageIds.has(tgt)
      return isLineageLink ? 'rgba(210, 195, 255, 0.95)' : 'rgba(140, 130, 175, 0.05)'
    }

    if (selectedNodeId) {
      const isSelectedLink = src === selectedNodeId || tgt === selectedNodeId
      return isSelectedLink ? 'rgba(210, 195, 255, 0.85)' : 'rgba(140, 130, 175, 0.05)'
    }

    const isExpandedLink = expandedNodeIds.has(src) || expandedNodeIds.has(tgt)
    return isExpandedLink ? 'rgba(200, 185, 255, 0.4)' : 'rgba(140, 130, 175, 0.16)'
  }, [expandedNodeIds, selectedNodeId, hoveredNodeId, activeLineageIds])

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
      onContextMenu={handleContextMenu}
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
          cooldownTicks={100} // Allow light physics simulation
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkCurvature={linkCurvature}
          linkDirectionalArrowLength={0}
          linkDirectionalParticles={0}
          enableNodeDrag={true} // Enable dragging
          onNodeDrag={handleNodeDrag}       // Intercept drag to lock to ring
          onNodeDragEnd={handleNodeDragEnd} // Pin upon release
          onNodeClick={handleNodeClick}
          onBackgroundClick={handleBackgroundClick}
          onNodeRightClick={handleNodeRightClick}
          onNodeHover={(node: any) => {
            setHoveredNodeId(node?.id ?? null)
            if (containerRef.current) {
              if (connectingFrom) {
                containerRef.current.style.cursor = 'crosshair'
              } else {
                containerRef.current.style.cursor = node ? 'pointer' : 'default'
              }
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

      {/* Context Menu */}
      {contextMenu && (
        <div
          style={{
            position: 'absolute',
            left: contextMenu.x,
            top: contextMenu.y,
            background: 'rgba(10,12,16,0.95)',
            border: '1px solid rgba(190,170,255,0.3)',
            borderRadius: 8,
            padding: '8px 0',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            zIndex: 1000,
            minWidth: 150,
          }}
        >
          {contextMenu.type === 'canvas' && (
            <button
              onClick={() => {
                // Use screen2GraphCoords to convert coordinates properly
                const graphCoords = graphRef.current?.screen2GraphCoords(contextMenu.x, contextMenu.y)
                handleAddManualNode(graphCoords?.x, graphCoords?.y)
              }}
              style={{
                width: '100%',
                padding: '8px 16px',
                background: 'none',
                border: 'none',
                color: 'rgba(220,214,240,0.9)',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                fontFamily: '-apple-system,"Segoe UI",sans-serif',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(191, 149, 249, 0.2)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'none'
              }}
            >
              Add Manual Node
            </button>
          )}
          {contextMenu.type === 'node' && contextMenu.nodeId && (
            <button
              onClick={() => handleDeleteManualNode(contextMenu.nodeId!)}
              style={{
                width: '100%',
                padding: '8px 16px',
                background: 'none',
                border: 'none',
                color: 'rgba(239, 68, 68, 0.9)', // Red color for delete
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                fontFamily: '-apple-system,"Segoe UI",sans-serif',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'none'
              }}
            >
              Delete Node
            </button>
          )}
        </div>
      )}
    </div>
  )
}