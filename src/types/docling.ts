// ─── Raw Docling JSON shape ───────────────────────────────────────────────────

export type DocNodeType =
  | 'toc' | 'section' | 'subsection' | 'paragraph'
  | 'table' | 'figure' | 'caption' | 'header' | 'footer' | 'list'
  | string

export interface BBox {
  x: number; y: number; w: number; h: number; page?: number
}


export type GraphNodeData = {
  nodeType:   string
  label:      string
  page:       number
  depth:      number
  isSelected: boolean   // ← add this
}
export interface DocNode {
  id?: string
  title: string
  page: number
  level: number
  type: DocNodeType
  children: DocNode[]
  page_range?: [number, number]
  bbox?: BBox
  text?: string
  vector?: number[]
}

// ─── Force-graph node (used by react-force-graph) ─────────────────────────────
export interface FGNode {
  id: string
  // display
  label: string
  nodeType: DocNodeType
  depth: number
  page: number
  page_range: [number, number]
  bbox?: BBox
  // original
  docNode: DocNode
  // runtime state
  isSelected: boolean
  // injected by force-graph at runtime
  x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number
}

// ─── Force-graph link (used by react-force-graph) ─────────────────────────────
export interface FGLink {
  id: string
  source: string
  target: string
  color: string
}

export type AppStatus = 'idle' | 'loading' | 'processing' | 'ready' | 'error'