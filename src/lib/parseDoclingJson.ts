import type { DocNode, FGNode, FGLink, DocNodeType } from '../types/docling'

// ─── Color map ────────────────────────────────────────────────────────────────
export const NODE_TYPE_COLORS: Record<string, string> = {
  toc:        '#7c3aed',
  section:    '#2563eb',
  subsection: '#0891b2',
  paragraph:  '#059669',
  table:      '#d97706',
  figure:     '#dc2626',
  caption:    '#6d28d9',
  header:     '#1d4ed8',
  footer:     '#555577',
  list:       '#15803d',
}

export function getNodeColor(type: DocNodeType | string): string {
  return NODE_TYPE_COLORS[type as string] ?? '#6b7280'
}

// ─── Normalize input ──────────────────────────────────────────────────────────
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

// ─── Build flat FGNode + FGLink arrays (BFS, no positions needed) ─────────────
let _counter = 0

export function parseDoclingJson(rawInput: unknown): {
  nodes: FGNode[]
  links: FGLink[]
  root: DocNode
} {
  _counter = 0
  const root = normalizeInput(rawInput)
  const nodes: FGNode[] = []
  const links: FGLink[] = []

  // BFS traversal — assign IDs, build node/link arrays
  type QI = { node: DocNode; parentId: string | null; depth: number }
  const queue: QI[] = [{ node: root, parentId: null, depth: 0 }]

  while (queue.length > 0) {
    const { node, parentId, depth } = queue.shift()!
    _counter++
    const id = node.id ?? `n-${_counter}`
    node.id = id   // mutate so flattenTree / Sidebar sees this ID

    nodes.push({
      id,
      label: node.title || `[${node.type}]`,
      nodeType: node.type,
      depth,
      page: node.page,
      page_range: node.page_range ?? [node.page, node.page],
      bbox: node.bbox,
      docNode: node,
      isSelected: false,
    })

    if (parentId) {
      links.push({
        id: `l-${parentId}-${id}`,
        source: parentId,
        target: id,
        color: getNodeColor(node.type),
      })
    }

    for (const child of node.children ?? []) {
      queue.push({ node: child, parentId: id, depth: depth + 1 })
    }
  }

  return { nodes, links, root }
}

// ─── Flatten tree for Sidebar ─────────────────────────────────────────────────
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
