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

// ─── Build flat FGNode + FGLink arrays (DFS Hierarchical IDs) ─────────────────
export function parseDoclingJson(rawInput: unknown): {
  nodes: FGNode[]
  links: FGLink[]
  root: DocNode
} {
  const root = normalizeInput(rawInput)
  const nodes: FGNode[] = []
  const links: FGLink[] = []

  // DFS recursive traversal — builds exact matching hierarchical IDs (e.g. node_0_1_2)
  function traverse(docNodes: DocNode[], parentId: string | null, depth: number, pathPrefix: string) {
    docNodes.forEach((node, i) => {
      
      // 1. Build the path string (e.g., "0", "0_1", "0_1_2")
      const currentPath = `${pathPrefix}${i}`
      
      // 2. Create the ID to strictly match the Python Backend!
      const id = `node_${currentPath}`
      
      node.id = id   // mutate so flattenTree / Sidebar sees this exact ID

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

      // 3. Process children, passing down the current path with an underscore
      if (node.children && node.children.length > 0) {
        traverse(node.children, id, depth + 1, `${currentPath}_`)
      }
    })
  }

  // Kick off the traversal. Root gets "0", its children get "0_0", "0_1", etc.
  traverse([root], null, 0, "")

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