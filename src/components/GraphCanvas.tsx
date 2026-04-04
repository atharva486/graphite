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

// 🚀 DYNAMIC RADIUS HELPER: Expands the universe for AI nodes automatically
function getRadius(depth: number) {
  if (depth <= 0) return 0;
  if (depth < RING_RADII.length) return RING_RADII[depth];
  // If we exceed predefined rings, add 380px per extra level
  const lastRadius = RING_RADII[RING_RADII.length - 1];
  const extraLevels = depth - (RING_RADII.length - 1);
  return lastRadius + (extraLevels * 380); 
}

export function GraphCanvas() {
  const fgNodes        = useDocStore(s => s.flowNodes)
  const fgEdges        = useDocStore(s => s.flowEdges)
  const selectNode     = useDocStore(s => s.selectNode)
  const status         = useDocStore(s => s.status)
  const selectedNodeId = useDocStore(s => s.selectedNodeId)

  // -- UI States --
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set())
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number, y: number } | null>(null);
  const [suggestedCards, setSuggestedCards] = useState<any[] | null>(null);

  // -- Refs & Dimensions --
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef     = useRef<any>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const nodeCacheRef = useRef<Map<string, any>>(new Map())

  const maxDepth = useMemo(
    () => Math.max(...fgNodes.map(n => n.depth ?? 0), 1),
    [fgNodes]
  )

  // ─── IPC Handlers ────────────────────────────────────────────────────────────

  // 1. Fetch AI Suggestions from Electron
  const handleGenerateSuggestions = useCallback(async () => {
    if (!selectedNodeId) return;

    const storeState = useDocStore.getState();
    const currentNodes = storeState.flowNodes;
    const dynamicJsonPath = storeState.jsonPath; 

    const selectedNode = currentNodes.find((n: any) => n.id === selectedNodeId);
    
    if (!selectedNode) return;
    if (!dynamicJsonPath) {
      console.error("🛑 No file path found in store! Make sure you save it when opening a file.");
      return;
    }

    console.log(`🖱️ Requesting AI Cards for: ${selectedNode.label} (${selectedNode.id})`);
    setIsGenerating(true);
    setSuggestedCards(null); 

    try {
      const payload = {
        node_id: selectedNode.id, 
        json_path: dynamicJsonPath, 
        visited_ids: []
      };

      const data = await window.electronAPI.getAiCards(payload);

      if (!data || data.error) {
        console.error("🛑 AI Engine Error:", data?.error);
        return; 
      }

      console.log("🧠 GEMINI CARDS ARRIVED!", data);

      const fetchedCards: any[] = [];
      Object.keys(data).forEach((key) => {
        if (key.startsWith('card_')) {
          fetchedCards.push({
            key: key, 
            ...data[key]
          });
        }
      });

      setSuggestedCards(fetchedCards); 

    } catch (error: any) {
      console.error("❌ IPC Error:", error);
    } finally {
      setIsGenerating(false);
    }
  }, [selectedNodeId]);

  // 2. Add an AI suggestion card to the actual graph store
  const handleAddCardToGraph = useCallback((card: any, cardKey: string) => {
    if (!selectedNodeId) return;
    
    const storeState = useDocStore.getState();
    const currentNodes = storeState.flowNodes;
    const selectedNode = currentNodes.find((n: any) => n.id === selectedNodeId);
    if (!selectedNode) return;

    // Find the maximum depth of regular document nodes
    const docNodes = currentNodes.filter((n: any) => n.nodeType !== 'ai_suggestion');
    const docMaxDepth = Math.max(...docNodes.map((n: any) => n.depth ?? 0), 1);

    const aiNodeId = `ai_${selectedNodeId}_${cardKey}_${Date.now()}`; 

    const newNode = {
      id: aiNodeId,
      label: card.concept || card.style?.replace('_', ' ').toUpperCase() || "AI Suggestion", 
      depth: docMaxDepth + 1, // Forces the node to the outermost AI orbit
      nodeType: 'ai_suggestion', 
      page: 'AI', 
      data: { label: card.suggestion },
      isSelected: false,
      x: (selectedNode.x || 0) + (Math.random() - 0.5) * 120,
      y: (selectedNode.y || 0) + (Math.random() - 0.5) * 120,
    };

    const newEdge = {
      id: `link_${selectedNodeId}_${aiNodeId}`,
      source: selectedNodeId,
      target: aiNodeId,
      color: '#fbbf24', 
    };

    useDocStore.setState((state: any) => ({
      flowNodes: [...state.flowNodes, newNode],
      flowEdges: [...state.flowEdges, newEdge]
    }));

    setSuggestedCards((prev) => prev ? prev.filter((c) => c.key !== cardKey) : null);
    
  }, [selectedNodeId]);

// 3. Save ONLY the AI Nodes to a NEW JSON file
  const handleSaveGraph = useCallback(async () => {
    const storeState = useDocStore.getState();
    const currentNodes = storeState.flowNodes;
    const currentEdges = storeState.flowEdges as any[];
    const filePath = storeState.jsonPath; 
  
    console.log("💾 Preparing AI nodes for separate save...");

    // 1. FILTER: Grab ONLY the AI suggestion nodes
    const aiNodesOnly = currentNodes.filter((n: any) => n.nodeType === 'ai_suggestion');

    if (aiNodesOnly.length === 0) {
      alert("No AI suggestions to save yet!");
      return;
    }
  
    // 2. FORMAT: Map them properly with their parent IDs
    const formattedData = aiNodesOnly.map((node: any) => {
      // Find the edge where THIS node is the target (to find its parent)
      const parentEdge = currentEdges.find((e: any) => {
        const targetId = typeof e.target === 'object' ? e.target.id : e.target;
        return targetId === node.id;
      });
  
      const parentId = parentEdge 
        ? (typeof parentEdge.source === 'object' ? (parentEdge.source as any).id : parentEdge.source) 
        : null;
  
      return {
        id: node.id,
        label: node.label,
        suggestion_text: node.data?.label || "",
        depth: node.depth,
        page: node.page,
        parent_id: parentId, // 👈 Crucial: Links back to the original doc's node
        is_new: true
      };
    });

    // 3. CREATE NEW FILE NAME: Don't overwrite the original!
    let newFilePath = "";
    if (filePath) {
      newFilePath = filePath.endsWith('.json') 
        ? filePath.replace('.json', '_ai_suggestions.json') 
        : `${filePath}_ai_suggestions.json`;
    }
  
    try {
      const response = await window.electronAPI.saveGraphJson({
        json_path: newFilePath || "", // Backend handles fallback if empty
        graph_data: formattedData
      });
  
      if (response.error) {
        console.error("❌ Save failed:", response.error);
        alert("Failed to save AI nodes!");
      } else {
        console.log(`✅ AI nodes saved successfully to a NEW file: ${response.saved_path}`);
        alert("AI Suggestions saved to a new file!");
      }
    } catch (err) {
      console.error("❌ IPC Error during save:", err);
    }
  }, []);

  // ─── Graph Logic & Lifecycle ─────────────────────────────────────────────────
  
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
        const savedFx = node.fx
        const savedFy = node.fy
        const savedDragged = node.__hasBeenDragged
        Object.assign(node, src)
        node.fx = savedFx
        node.fy = savedFy
        node.__hasBeenDragged = savedDragged
      }
    }

    const allNodes = Array.from(cache.values()).filter(n => liveIds.has(n.id))

    const parentOf = new Map<string, string>()
    fgEdges.forEach(e => {
      const s = typeof e.source === 'object' ? (e.source as any).id : String(e.source)
      const t = typeof e.target === 'object' ? (e.target as any).id : String(e.target)
      parentOf.set(t, s)
    })

    const childrenOf = new Map<string, string[]>()
    allNodes.forEach(n => {
      n._parentId = parentOf.get(n.id) ?? null
      if (n._parentId) {
        if (!childrenOf.has(n._parentId)) childrenOf.set(n._parentId, [])
        childrenOf.get(n._parentId)!.push(n.id)
      }
    })

    childrenOf.forEach(kids => {
      kids.sort((a, b) => {
        const na = cache.get(a)
        const nb = cache.get(b)
        return String(na?.label ?? a).localeCompare(String(nb?.label ?? b))
      })
    })

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
    
    let rootIndex = 1
    roots.forEach(r => assignReadingOrder(r.id, rootIndex++))
    
    if (roots.length > 0) {
      roots[0].__isRingDrawer = true
    }

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

    allNodes.forEach(n => {
      const d = n.depth ?? 0
      const radiusToUse = getRadius(d); 
      
      n._dragRadius = radiusToUse 

      const angle = targetAngle.get(n.id) ?? 0
      n.x = radiusToUse * Math.cos(angle)
      n.y = radiusToUse * Math.sin(angle)
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

    nodes.forEach(n => {
      if (n._parentId === hoveredNodeId) ids.add(n.id)
    })

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
        const nx = node.x ?? 0
        const ny = node.y ?? 0
        const depth = node.depth ?? 0
        const targetR = getRadius(depth);
        
        const dist = Math.sqrt(nx * nx + ny * ny) || 1
        const diff = targetR - dist
        const strength = 1.6 * alpha  
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

    fg.d3ReheatSimulation?.()
  }, [graphData])

  const handleNodeDrag = useCallback((node: any) => {
    node.__hasBeenDragged = true
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
  }, [])

  const handleNodeDragEnd = useCallback((node: any) => {
    node.__hasBeenDragged = true
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
  }, [])

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
          const radius = getRadius(i); 
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
      const isExpanded = expandedNodeIds.has(node.id)
      const isHovered = hoveredNodeId === node.id
      const inHoverLineage = activeLineageIds.has(node.id)
      const isActivated = isSelected || isExpanded
      const color = depthColor(depth)

      let focusOpacity = 1
      if (hoveredNodeId) {
        focusOpacity = inHoverLineage ? 1 : 0.12
      }

      ctx.save()
      ctx.globalAlpha = focusOpacity

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

      if (node._readingOrder != null) {
        ctx.save()
        ctx.font = `600 ${Math.max(7, 8 / globalScale)}px monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = 'rgba(0,0,0,0.6)'
        ctx.fillText(String(node._readingOrder), nx, ny - r * 0.3)
        ctx.restore()
      }

      const minScale = depth === 0 ? 0 : depth === 1 ? 0.3 : depth === 2 ? 0.7 : 1.2
      if (globalScale >= minScale || isActivated || inHoverLineage) {
        const raw = (node.label || node.data?.label || '').trim()
        if (!raw) {
          ctx.restore()
          return
        }

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

  // ─── Interaction Handlers ────────────────────────────────────────────────────

  const closeMenu = useCallback(() => {
    setMenuPos(null);
  }, []);

  const handleNodeClick = useCallback((n: any) => {
    closeMenu(); 
    setExpandedNodeIds(prev => {
      const next = new Set(prev)
      if (next.has(n.id)) next.delete(n.id)
      else next.add(n.id)
      return next
    })
    selectNode(n.id)
  }, [selectNode, closeMenu])

  const handleBackgroundClick = useCallback(() => {
    closeMenu(); 
    selectNode(null);
    setSuggestedCards(null); 
  }, [selectNode, closeMenu])

  const handleNodeRightClick = useCallback((node: any, event: MouseEvent) => {
    selectNode(node.id);
    setMenuPos({ x: event.clientX, y: event.clientY });
  }, [selectNode]);

  const handleBackgroundRightClick = useCallback(() => {
    closeMenu();
    selectNode(null);
  }, [selectNode, closeMenu]);

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

  // ─── Render ──────────────────────────────────────────────────────────────────

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
      onContextMenu={(e) => e.preventDefault()}
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
          cooldownTicks={100}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkCurvature={linkCurvature}
          linkDirectionalArrowLength={0}
          linkDirectionalParticles={0}
          enableNodeDrag={true} 
          onNodeDrag={handleNodeDrag}       
          onNodeDragEnd={handleNodeDragEnd} 
          
          onNodeClick={handleNodeClick}
          onBackgroundClick={handleBackgroundClick}
          onNodeRightClick={handleNodeRightClick} 
          onBackgroundRightClick={handleBackgroundRightClick}
          
          onZoom={closeMenu}

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

      {/* 💾 SAVE BUTTON */}
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 100 }}>
        <button
          onClick={handleSaveGraph}
          style={{
            background: 'rgba(78, 201, 160, 0.15)', 
            color: '#4ec9a0',
            border: '1px solid rgba(78, 201, 160, 0.4)',
            borderRadius: '8px',
            padding: '8px 16px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            transition: 'all 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.background = 'rgba(78, 201, 160, 0.25)'}
          onMouseOut={(e) => e.currentTarget.style.background = 'rgba(78, 201, 160, 0.15)'}
        >
          💾 Save Graph
        </button>
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

      {menuPos && selectedNodeId && (
        <div
          style={{
            position: 'fixed',
            top: menuPos.y,
            left: menuPos.x,
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(15, 18, 24, 0.95)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(190, 149, 249, 0.3)', 
            borderRadius: '8px',
            padding: '4px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
            zIndex: 9999, 
            minWidth: '160px',
            transform: 'translate(2px, 2px)', 
          }}
        >
          <button
            onClick={() => {
              handleGenerateSuggestions();
              closeMenu(); 
            }}
            disabled={isGenerating}
            style={{
              background: 'transparent',
              color: isGenerating ? '#9ca3af' : '#e2e8f0',
              border: 'none',
              borderRadius: '4px',
              padding: '8px 12px',
              fontSize: '13px',
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              textAlign: 'left',
              width: '100%',
            }}
            onMouseOver={(e) => {
              if (!isGenerating) e.currentTarget.style.background = 'rgba(191, 149, 249, 0.15)'
            }}
            onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
          >
            {isGenerating ? '⏳ Thinking...' : '✨ Get AI Suggestion'}
          </button>
        </div>
      )}

      {suggestedCards && suggestedCards.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            width: '320px',
            maxHeight: 'calc(100% - 40px)',
            overflowY: 'auto',
            background: 'rgba(15, 18, 24, 0.95)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(190, 149, 249, 0.4)',
            borderRadius: '12px',
            padding: '16px',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
            fontFamily: '-apple-system,"Segoe UI",sans-serif',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h3 style={{ color: '#e2e8f0', margin: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>✨</span> AI Suggestions
            </h3>
            <button 
              onClick={() => setSuggestedCards(null)} 
              style={{ 
                background: 'transparent', border: 'none', color: '#9ca3af', 
                cursor: 'pointer', fontSize: '16px', padding: '4px' 
              }}
              title="Close"
            >
              ✖
            </button>
          </div>
          
          {suggestedCards.map((card) => (
            <div 
              key={card.key} 
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(190,180,220,0.15)',
                borderRadius: '8px', 
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              <div style={{ color: '#bf95f9', fontWeight: 'bold', fontSize: '13px' }}>
                {card.concept || card.style?.replace('_', ' ').toUpperCase() || 'New Idea'}
              </div>
              <div style={{ color: '#cbd5e1', fontSize: '12.5px', lineHeight: '1.4' }}>
                {card.suggestion}
              </div>
              <button 
                onClick={() => handleAddCardToGraph(card, card.key)}
                style={{
                  width: '100%', 
                  background: 'rgba(191, 149, 249, 0.1)',
                  color: '#bf95f9', 
                  border: '1px solid rgba(191, 149, 249, 0.3)',
                  borderRadius: '6px', 
                  padding: '8px 0', 
                  fontSize: '12px', 
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginTop: '4px',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.background = 'rgba(191, 149, 249, 0.2)'}
                onMouseOut={(e) => e.currentTarget.style.background = 'rgba(191, 149, 249, 0.1)'}
              >
                + Add to Graph
              </button>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}