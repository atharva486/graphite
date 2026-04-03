export type DocNodeType =
  | 'toc'
  | 'section'
  | 'subsection'
  | 'paragraph'
  | 'table'
  | 'figure'
  | 'caption'
  | 'header'
  | 'footer'
  | 'list'
  | string

export interface BBox {
  x: number
  y: number
  w: number
  h: number
  page?: number
}

export interface DocNode {
  title: string
  page: number
  level: number
  type: DocNodeType
  children: DocNode[]
  page_range: [number, number]
  bbox?: BBox
  text?: string
  vector?: number[]
  id?: string
}

export interface GraphNodeData extends Record<string, unknown> {
  label: string
  docNode: DocNode
  nodeType: DocNodeType
  level: number
  depth: number           // tree depth (0 = root), not the raw JSON level
  page: number
  page_range: [number, number]
  bbox?: BBox
  isSelected?: boolean
}

export interface SemanticEdge {
  id: string
  source: string
  target: string
  similarity?: number
  edgeType: 'hierarchy' | 'semantic'
}

export type AppStatus = 'idle' | 'loading' | 'processing' | 'ready' | 'error'
