import { flattenTree, getNodeColor, NODE_TYPE_COLORS } from '../lib/parseDoclingJson'
import { useDocStore } from '../store/useDocStore'

interface SidebarProps {
  className?: string
}

export function Sidebar({ className }: SidebarProps) {
  const { docTree, selectedNodeId, selectNode } = useDocStore()

  if (!docTree){
    return (
      <aside className={`sidebar sidebar--empty ${className ?? ''}`}>
        <div className="sidebar-header">
          <span className="sidebar-title">Document Outline</span>
        </div>
        <div className="sidebar-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <p>No document loaded</p>
        </div>
      </aside>
    )
  }

  // Skip virtual root wrapper (added when input is a flat array)
  const itemsRaw = flattenTree(docTree)
  const items = docTree.id === 'root' ? itemsRaw.slice(1).map(i => ({ ...i, depth: i.depth - 1 })) : itemsRaw

  return (
    <aside className={`sidebar ${className ?? ''}`}>
      <div className="sidebar-header">
        <span className="sidebar-title">Document Outline</span>
        <span className="sidebar-badge">{items.length}</span>
      </div>

      {/* Legend */}
      <div className="sidebar-legend">
        {Object.entries(NODE_TYPE_COLORS).slice(0, 6).map(([type, color]) => (
          <span key={type} className="legend-item">
            <span className="legend-dot" style={{ background: color }} />
            {type}
          </span>
        ))}
      </div>

      <div className="sidebar-scroll">
        {items.map(({ node, depth: itemDepth }) => {
          const nodeId = node.id!           // guaranteed by parser mutation
          const isSelected = selectedNodeId === nodeId
          const color = getNodeColor(node.type)
          return (
            <button
              key={nodeId}
              className={`sidebar-item ${isSelected ? 'sidebar-item--selected' : ''}`}
              style={{ paddingLeft: `${12 + itemDepth * 14}px` }}
              onClick={() => selectNode(isSelected ? null : nodeId)}
            >
              <span className="sidebar-item-dot" style={{ background: color }} />
              <span className="sidebar-item-label">{node.title || `[${node.type}]`}</span>
              <span className="sidebar-item-page">p.{node.page}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
