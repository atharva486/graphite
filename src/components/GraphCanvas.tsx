import { useCallback, useEffect, memo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type NodeChange,
  type EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  BackgroundVariant,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { FGNode, FGLink, GraphNodeData } from '../types/docling'
import { useDocStore } from '../store/useDocStore'
import { getNodeColor } from '../lib/parseDoclingJson'

// ─── Convert store types → ReactFlow types ────────────────────────────────────
function toFlowNode(n: FGNode): Node<GraphNodeData> {
  return {
    id:       n.id,
    type:     'docNode',
    position: { x: n.x ?? 0, y: n.y ?? 0 },
    selected: n.isSelected,
    data: {
      nodeType:   n.nodeType,
      label:      n.label,
      page:       n.page,
      depth:      n.depth,
      isSelected: n.isSelected,
    },
  }
}

function toFlowEdge(l: FGLink): Edge {
  return {
    id:     l.id,
    source: l.source,
    target: l.target,
    style:  { stroke: l.color },
  }
}

// ─── Custom Node ──────────────────────────────────────────────────────────────
const DocNodeComponent = memo(({ data, selected }: NodeProps<Node<GraphNodeData>>) => {
  const color = getNodeColor(data.nodeType)
  return (
    <div
      className={`flow-node ${selected ? 'flow-node--selected' : ''}`}
      style={{ borderColor: color, '--node-color': color } as React.CSSProperties}
    >
      <div className="flow-node-type" style={{ color }}>
        {data.nodeType}
      </div>
      <div className="flow-node-label">{data.label}</div>
      <div className="flow-node-meta">
        p.{data.page} &nbsp;·&nbsp; depth {data.depth}
      </div>
    </div>
  )
})
DocNodeComponent.displayName = 'DocNodeComponent'

const nodeTypes = { docNode: DocNodeComponent }

// ─── FlowController: pans viewport to selected node ──────────────────────────
function FlowController() {
  const { fitView } = useReactFlow()
  const selectedNodeId = useDocStore(s => s.selectedNodeId)

  useEffect(() => {
    if (!selectedNodeId) return
    const t = setTimeout(() => {
      fitView({
        nodes:    [{ id: selectedNodeId }],
        duration: 500,
        padding:  0.4,
        maxZoom:  1.5,
      })
    }, 50)
    return () => clearTimeout(t)
  }, [selectedNodeId, fitView])

  return null
}

// ─── Graph Canvas ─────────────────────────────────────────────────────────────
export function GraphCanvas() {
  const fgNodes    = useDocStore(s => s.flowNodes)   // FGNode[]
  const fgEdges    = useDocStore(s => s.flowEdges)   // FGLink[]
  const selectNode = useDocStore(s => s.selectNode)
  const updateFlowNodes = useDocStore(s => s.updateFlowNodes)
  const updateFlowEdges = useDocStore(s => s.updateFlowEdges)
  const status     = useDocStore(s => s.status)

  // Convert to ReactFlow types once per render
  const flowNodes: Node<GraphNodeData>[] = fgNodes.map(toFlowNode)
  const flowEdges: Edge[]                = fgEdges.map(toFlowEdge)

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<GraphNodeData>>[]) => {
      updateFlowNodes(
        applyNodeChanges(changes, flowNodes).map(n => ({
          ...fgNodes.find(fg => fg.id === n.id)!,
          x:          n.position.x,
          y:          n.position.y,
          isSelected: n.selected ?? false,
        }))
      )
    },
    [flowNodes, fgNodes, updateFlowNodes],
  )

    const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const updated = applyEdgeChanges(changes, flowEdges) as Array<
        Edge & { style?: { stroke?: string } }
      >

      updateFlowEdges(
        updated.map(e => ({
          id:     e.id,
          source: e.source,
          target: e.target,
          color:  e.style?.stroke ?? '#555',
        }))
      )
    },
    [flowEdges, updateFlowEdges],
  )

  const onNodeClick  = useCallback(
    (_: React.MouseEvent, node: Node) => selectNode(node.id),
    [selectNode],
  )
  const onPaneClick  = useCallback(() => selectNode(null), [selectNode])

  // ── Empty / loading states ─────────────────────────────────────────────────
  if (status === 'idle') {
    return (
      <div className="graph-empty">
        <div className="graph-empty-content">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="1">
            <circle cx="12" cy="5"  r="3"/>
            <circle cx="4"  cy="19" r="3"/>
            <circle cx="20" cy="19" r="3"/>
            <line x1="12" y1="8" x2="4"  y2="16"/>
            <line x1="12" y1="8" x2="20" y2="16"/>
          </svg>
          <h2>Your Semantic Graph</h2>
          <p>Load a Docling JSON file to visualize the document structure as an interactive knowledge graph.</p>
        </div>
      </div>
    )
  }

  if (status === 'loading' || status === 'processing') {
    return (
      <div className="graph-empty">
        <div className="graph-empty-content">
          <div className="spinner"/>
          <p>Parsing document...</p>
        </div>
      </div>
    )
  }

  // ── Main graph ─────────────────────────────────────────────────────────────
  return (
    <div className="graph-canvas">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={{
          type:      'smoothstep',
          style:     { strokeWidth: 2, opacity: 0.7 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#555', width: 10, height: 10 },
        }}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.02}
        maxZoom={2}
        deleteKeyCode={null}
      >
        <FlowController/>
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1e1e2e"/>
        <Controls
          style={{ background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: '8px' }}
        />
        <MiniMap
          nodeColor={n => getNodeColor((n.data as GraphNodeData)?.nodeType ?? '')}
          style={{ background: '#0d0d1a', border: '1px solid #2a2a3e', borderRadius: '8px' }}
          maskColor="rgba(0,0,0,0.6)"
        />
      </ReactFlow>
    </div>
  )
}