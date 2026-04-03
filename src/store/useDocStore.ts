import { create } from 'zustand'
import type { Node, Edge } from '@xyflow/react'
import type { DocNode, AppStatus, GraphNodeData } from '../types/docling'
import { parseDoclingJson } from '../lib/parseDoclingJson'

interface DocStore {
  // Document
  docTree: DocNode | null
  flowNodes: Node<GraphNodeData>[]
  flowEdges: Edge[]

  // Selection
  selectedNodeId: string | null

  // PDF
  pdfPath: string | null
  jsonPath: string | null

  // Status
  status: AppStatus
  statusMessage: string

  // Actions
  loadFromJson: (raw: unknown, jsonPath?: string) => void
  selectNode: (id: string | null) => void
  setPdfPath: (path: string) => void
  setStatus: (status: AppStatus, message?: string) => void
  updateFlowNodes: (nodes: Node<GraphNodeData>[]) => void
  updateFlowEdges: (edges: Edge[]) => void
  reset: () => void
}

export const useDocStore = create<DocStore>((set, get) => ({
  docTree: null,
  flowNodes: [],
  flowEdges: [],
  selectedNodeId: null,
  pdfPath: null,
  jsonPath: null,
  status: 'idle',
  statusMessage: 'Open a JSON file or PDF to begin',

  loadFromJson: (raw, jsonPath) => {
    try {
      set({ status: 'loading', statusMessage: 'Parsing document...' })
      const { nodes, edges, root } = parseDoclingJson(raw)
      set({
        docTree: root,
        flowNodes: nodes,
        flowEdges: edges,
        jsonPath: jsonPath ?? null,
        status: 'ready',
        statusMessage: `Loaded: ${root.title || 'Document'} — ${nodes.length} nodes`,
        selectedNodeId: null,
      })
    } catch (e) {
      set({ status: 'error', statusMessage: `Parse error: ${(e as Error).message}` })
    }
  },

  selectNode: (id) => {
    const { flowNodes } = get()
    const updated = flowNodes.map((n) => ({
      ...n,
      data: { ...n.data, isSelected: n.id === id },
    }))
    set({ selectedNodeId: id, flowNodes: updated })
  },

  setPdfPath: (path) => set({ pdfPath: path }),

  setStatus: (status, message) =>
    set({ status, statusMessage: message ?? '' }),

  updateFlowNodes: (nodes) => set({ flowNodes: nodes }),
  updateFlowEdges: (edges) => set({ flowEdges: edges }),

  reset: () =>
    set({
      docTree: null,
      flowNodes: [],
      flowEdges: [],
      selectedNodeId: null,
      pdfPath: null,
      jsonPath: null,
      status: 'idle',
      statusMessage: 'Open a JSON file or PDF to begin',
    }),
}))
