import { useDocStore } from '../store/useDocStore'

export function RecommendationsPanel() {
  const { selectedNodeId, flowNodes } = useDocStore()

  const selectedNode = selectedNodeId
    ? flowNodes.find((n) => n.id === selectedNodeId)
    : null

  if (!selectedNode) {
    return null
  }

  return (
    <div className="recommendations-panel">
      <div className="recommendations-header">
        <h4>Node Details</h4>
      </div>

      <div className="recommendations-content">
        <div className="recommendations-section">
          <h5>Selected Node</h5>
          <p>{selectedNode.label}</p>
        </div>
      </div>
    </div>
  )
}
