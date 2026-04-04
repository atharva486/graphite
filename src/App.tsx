import './App.css'
import { useEffect } from 'react'
import { Toolbar } from './components/Toolbar'
import { Sidebar } from './components/Sidebar'
import { GraphCanvas } from './components/GraphCanvas'
import { PdfViewer } from './components/PdfViewer'
import { useDocStore } from './store/useDocStore'

function App() {
  const loadManualNodes = useDocStore(s => s.loadManualNodes)

  useEffect(() => {
    loadManualNodes()
  }, [loadManualNodes])

  return (
    <div className="app-shell">
      <Toolbar />
      <div className="app-body">
        <Sidebar />
        <main className="app-main">
          <GraphCanvas />
        </main>
        <PdfViewer />
      </div>
    </div>
  )
}

export default App
