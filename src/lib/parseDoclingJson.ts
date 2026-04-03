import type { Node, Edge } from '@xyflow/react'
import type { DocNode, GraphNodeData } from '../types/docling'

// ─── Color map per node type ─────────────────────────────────────────────────
export const NODE_TYPE_COLORS: Record<string, string> = {
  toc: '#7c3aed',
  section: '#2563eb',
  subsection: '#0891b2',
  paragraph: '#059669',
  table: '#d97706',
  figure: '#dc2626',
  caption: '#6d28d9',
  header: '#1d4ed8',
  footer: '#374151',
  list: '#15803d',
}

export function getNodeColor(type: string): string {
  return NODE_TYPE_COLORS[type] ?? '#6b7280'
}

// ─── Normalize: flat array OR rooted tree → single root DocNode ───────────────
export function normalizeInput(raw: unknown): DocNode {
  if (Array.isArray(raw)) {
    return {
      id: 'root',
      title: 'Document',
      page: (raw[0] as DocNode)?.page ?? 1,
      level: 0,
      type: 'toc',
      children: raw as DocNode[],
      page_range: [
        (raw[0] as DocNode)?.page ?? 1,
        (raw[raw.length - 1] as DocNode)?.page ?? 1,
      ],
    }
  }
  return raw as DocNode
}

// ─── BFS layout constants ─────────────────────────────────────────────────────
const X_GAP = 300   // horizontal gap between sibling nodes at the same level
const Y_GAP = 140   // vertical gap between levels

// ─── BFS layout entry point ───────────────────────────────────────────────────
export function parseDoclingJson(rawInput: unknown): {
  nodes: Node<GraphNodeData>[]
  edges: Edge[]
  root: DocNode
} {
  const root = normalizeInput(rawInput)
  const flowNodes: Node<GraphNodeData>[] = []
  const flowEdges: Edge[] = []

  // ── Pass 1: BFS to collect all nodes with their depth + parentId ────────────
  type QueueItem = { node: DocNode; parentId: string | null; depth: number }
  const queue: QueueItem[] = [{ node: root, parentId: null, depth: 0 }]
  const bfsOrder: QueueItem[] = []
  let counter = 0

  while (queue.length > 0) {
    const item = queue.shift()!
    counter++
    const nodeId = item.node.id ?? `node-${counter}`
    item.node.id = nodeId   // ← mutate so flattenTree() / Sidebar sees same ID
    bfsOrder.push(item)

    for (const child of item.node.children ?? []) {
      queue.push({ node: child, parentId: nodeId, depth: item.depth + 1 })
    }
  }

  // ── Pass 2: group nodes by depth level ──────────────────────────────────────
  const levels = new Map<number, typeof bfsOrder>()
  for (const item of bfsOrder) {
    if (!levels.has(item.depth)) levels.set(item.depth, [])
    levels.get(item.depth)!.push(item)
  }

  // ── Pass 3: assign X/Y — all nodes in a level share the same Y, ─────────── 
  //            evenly distributed across X centered on 0
  for (const [depth, nodesAtLevel] of levels) {
    const count = nodesAtLevel.length
    const totalWidth = (count - 1) * X_GAP

    nodesAtLevel.forEach((item, i) => {
      const nodeId = item.node.id!
      const x = i * X_GAP - totalWidth / 2
      const y = depth * Y_GAP
      const color = getNodeColor(item.node.type)

      // Create flow node
      flowNodes.push({
        id: nodeId,
        type: 'docNode',
        position: { x, y },
        data: {
          label: item.node.title || `[${item.node.type}]`,
          docNode: item.node,
          nodeType: item.node.type,
          level: item.node.level,
          depth,
          page: item.node.page,
          page_range: item.node.page_range ?? [item.node.page, item.node.page],
          bbox: item.node.bbox,
          isSelected: false,
        },
      })

      // Create edge to parent
      if (item.parentId) {
        flowEdges.push({
          id: `edge-${item.parentId}-${nodeId}`,
          source: item.parentId,
          target: nodeId,
          type: 'smoothstep',
          style: { stroke: color, strokeWidth: 2, opacity: 0.75 },
          data: { edgeType: 'hierarchy' },
        })
      }
    })
  }

  return { nodes: flowNodes, edges: flowEdges, root }
}

// ─── Flatten tree for sidebar (DFS pre-order, depth tracking) ────────────────
export function flattenTree(
  node: DocNode,
  depth = 0,
): Array<{ node: DocNode; depth: number }> {
  const result: Array<{ node: DocNode; depth: number }> = [{ node, depth }]
  for (const child of node.children ?? []) {
    result.push(...flattenTree(child, depth + 1))
  }
  return result
}
