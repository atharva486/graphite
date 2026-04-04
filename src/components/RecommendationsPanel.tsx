import { useDocStore } from '../store/useDocStore'

export function RecommendationsPanel() {
  const { recommendations, isRecommendationsLoading, recommendationsError, selectedNodeId, flowNodes } = useDocStore()

  const selectedNode = selectedNodeId
    ? flowNodes.find((n) => n.id === selectedNodeId)
    : null

  if (!selectedNode) {
    return null
  }

  return (
    <div className="recommendations-panel">
      <div className="recommendations-header">
        <h4>NLP Summary & Analysis</h4>
      </div>

      <div className="recommendations-content">
        {isRecommendationsLoading && (
          <div className="recommendations-state">
            <div className="spinner-small" />
            <span>Compressing tokens...</span>
          </div>
        )}

        {recommendationsError && (
          <div className="recommendations-error">
            <span>{recommendationsError}</span>
          </div>
        )}

        {!isRecommendationsLoading && recommendations && (
          <>
            <div className="recommendations-section">
              <h5>Token Compression</h5>
              <p>Reduced to {recommendations.compressed_tokens} key tokens.</p>
            </div>
            
            <div className="recommendations-section">
              <h5>Keywords</h5>
              <div className="keywords-list">
                {recommendations.keywords.map((kw, i) => (
                  <span key={i} className="keyword-chip">{kw}</span>
                ))}
              </div>
            </div>

            <div className="recommendations-section">
              <h5>Summary</h5>
              <p className="summary-text">{recommendations.summary}</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
