import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Log main-process debug messages if the API is available
window.electronAPI?.on?.('main-process-message', (_event: unknown, message: unknown) => {
  console.log('[main]', message)
})
