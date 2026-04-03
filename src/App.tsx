import './App.css'
import { Toolbar } from './components/Toolbar'
import { Sidebar } from './components/Sidebar'
import { GraphCanvas } from './components/GraphCanvas'
import { PdfViewer } from './components/PdfViewer'

function App() {
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
