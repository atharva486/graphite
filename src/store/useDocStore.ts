import { create } from 'zustand'
import type { FGNode, FGLink, DocNode, AppStatus, ManualNode } from '../types/docling'
import { parseDoclingJson } from '../lib/parseDoclingJson'

interface DocStore {
  docTree:        DocNode | null
  flowNodes:      FGNode[]          // ← FGNode not Node<GraphNodeData>
  flowEdges:      FGLink[]          // ← FGLink not Edge
  manualNodes:    ManualNode[]
  selectedNodeId: string | null
  pdfPath:        string | null
  jsonPath:       string | null
  status:         AppStatus
  statusMessage:  string
  scanProgress:   string

  loadFromJson:       (raw: unknown, jsonPath?: string) => void
  appendSubHeadings:  (range: [number, number], subHeadings: DocNode[]) => void
  selectNode:         (id: string | null) => void
  setPdfPath:         (path: string) => void
  setStatus:          (status: AppStatus, message?: string) => void
  setScanProgress:    (msg: string) => void
  updateFlowNodes:    (nodes: FGNode[]) => void
  updateFlowEdges:    (edges: FGLink[]) => void
  addManualNode:      (node: ManualNode) => void
  loadManualNodes:    () => Promise<void>
  saveManualNodes:    () => Promise<void>
  updateManualNode:   (id: string, updates: Partial<ManualNode>) => void
  deleteManualNode:   (id: string) => void
  reset:              () => void
}

function findNodeByPage(node: DocNode, page: number): DocNode | null {
  if (node.page === page) return node
  for (const child of node.children) {
    const found = findNodeByPage(child, page)
    if (found) return found
  }
  return null
}

const INITIAL: Omit<DocStore,
  | 'loadFromJson' | 'appendSubHeadings' | 'selectNode'
  | 'setPdfPath'   | 'setStatus'         | 'setScanProgress'
  | 'updateFlowNodes' | 'updateFlowEdges' | 'addManualNode' | 'loadManualNodes' | 'saveManualNodes' | 'updateManualNode' | 'deleteManualNode' | 'reset'
> = {
  docTree:        null,
  flowNodes:      [],
  flowEdges:      [],
  manualNodes:    [],
  selectedNodeId: null,
  pdfPath:        null,
  jsonPath:       null,
  status:         'idle',
  statusMessage:  'Open a JSON file or PDF to begin',
  scanProgress:   '',
}

export const useDocStore = create<DocStore>((set, get) => ({
  ...INITIAL,

  loadFromJson: (raw, jsonPath) => {
    try {
      set({ status: 'loading', statusMessage: 'Parsing document...' })
      const { nodes, links, root } = parseDoclingJson(raw)
      set({
        docTree:        root,
        flowNodes:      nodes,
        flowEdges:      links,
        jsonPath:       jsonPath ?? null,
        status:         'ready',
        statusMessage:  `Loaded: ${root.title || 'Document'} — ${nodes.length} nodes`,
        selectedNodeId: null,
        scanProgress:   '',
      })
    } catch (e) {
      set({ status: 'error', statusMessage: `Parse error: ${(e as Error).message}` })
    }
  },

  appendSubHeadings: (range, subHeadings) => {
    const { docTree } = get()
    if (!docTree || subHeadings.length === 0) return

    const parent = findNodeByPage(docTree, range[0])
    if (!parent) return

    const existing = new Set(parent.children.map(c => c.title?.trim().toLowerCase()))
    const fresh    = subHeadings.filter(h => !existing.has(h.title?.trim().toLowerCase()))
    if (fresh.length === 0) return

    parent.children = [...parent.children, ...fresh]

    const { nodes, links } = parseDoclingJson(docTree as unknown)
    set({
      docTree:   { ...docTree },
      flowNodes: nodes,
      flowEdges: links,
    })
  },

  selectNode: (id) => {
    // Only update selectedNodeId—do NOT mutate flowNodes to avoid graph rebuild chaos
    set({ selectedNodeId: id })
  },

  setPdfPath:      (path)        => set({ pdfPath: path }),
  setStatus:       (status, msg) => set({ status, statusMessage: msg ?? '' }),
  setScanProgress: (msg)         => set({ scanProgress: msg }),
  updateFlowNodes: (nodes)       => set({ flowNodes: nodes }),
  updateFlowEdges: (edges)       => set({ flowEdges: edges }),
  addManualNode:   (node)        => {
    set(state => ({ manualNodes: [...state.manualNodes, node] }))
    // Save after adding
    get().saveManualNodes()
  },
  loadManualNodes: async () => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      const result = await window.electronAPI.loadJsonFile('user-notes/manual-nodes.json')
      if (result.ok && Array.isArray(result.data)) {
        // Ensure backward compatibility: add isLinked field if missing
        const normalizedNodes = (result.data as any[]).map(node => ({
          ...node,
          isLinked: node.isLinked !== undefined ? node.isLinked : node.parents.length === 0
        })) as ManualNode[]
        set({ manualNodes: normalizedNodes })
      }
    }
  },
  saveManualNodes: async () => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      const { manualNodes } = get()
      await window.electronAPI.saveJsonFile('user-notes/manual-nodes.json', manualNodes)
    }
  },
  updateManualNode: (id, updates) => {
    set(state => ({
      manualNodes: state.manualNodes.map(mn => 
        mn.id === id ? { ...mn, ...updates } : mn
      )
    }))
    // Save after updating
    get().saveManualNodes()
  },
  deleteManualNode: (id) => {
    set(state => ({
      manualNodes: state.manualNodes.filter(mn => mn.id !== id)
    }))
    // Save after deleting
    get().saveManualNodes()
  },
  reset:           ()            => set({ ...INITIAL }),
}))