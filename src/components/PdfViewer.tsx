import { useEffect, useState } from 'react'
import { useDocStore } from '../store/useDocStore'

// --- react-pdf-viewer imports ---
import { Viewer, Worker } from '@react-pdf-viewer/core'
import { pageNavigationPlugin } from '@react-pdf-viewer/page-navigation'

// --- Required CSS ---
import '@react-pdf-viewer/core/lib/styles/index.css'

export function PdfViewer() {
  const { pdfPath, selectedNodeId, flowNodes } = useDocStore()

  const selectedNode = selectedNodeId
    ? flowNodes.find((n) => n.id === selectedNodeId)
    : null

  const page = selectedNode?.page ?? 1

  // 1. Initialize the navigation plugin
  const pageNavigationPluginInstance = pageNavigationPlugin()
  const { jumpToPage } = pageNavigationPluginInstance

  // 2. Safely jump to the page when the Zustand state changes
  useEffect(() => {
    if (jumpToPage) {
      // BUGFIX: react-pdf-viewer is zero-indexed! Page 1 is index 0.
      jumpToPage(page - 1)
    }
  }, [page, jumpToPage])

  // --- TTS State ---
  const [elevenLabsKey] = useState('sk_4f1ad594182d9cf55383e8b458c23b81e54495a05f9a4517')
  const [isPlaying, setIsPlaying] = useState(false)
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null)
  const [isReading, setIsReading] = useState(false)

  const handleTTS = async () => {
    if (isPlaying && audioElement) {
      audioElement.pause()
      audioElement.currentTime = 0
      setIsPlaying(false)
      return
    }

    if (!elevenLabsKey) {
      alert("Please enter ElevenLabs API Key")
      return;
    }

    // Attempt to read the actual docNode text or fallback to the label
    const textToRead = selectedNode?.docNode?.text || selectedNode?.label
    if (!textToRead) return;

    setIsReading(true);
    try {
      const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': elevenLabsKey
        },
        body: JSON.stringify({
          text: textToRead,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.5
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch audio: ${response.statusText}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      audio.onended = () => setIsPlaying(false);
      setAudioElement(audio);
      audio.play();
      setIsPlaying(true);
    } catch (err) {
      console.error(err);
      alert("Error playing TTS: " + String(err));
    } finally {
      setIsReading(false);
    }
  }

  // --- Empty State ---
  if (!pdfPath) {
    return (
      <aside className="pdf-viewer pdf-viewer--empty">
        <div className="pdf-viewer-header">
          <span>PDF Viewer</span>
        </div>
        <div className="pdf-viewer-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <p>No PDF loaded</p>
          <small>Open a PDF file to view it here alongside the graph</small>
        </div>
      </aside>
    )
  }

  // --- Loaded State ---
  return (
    <aside className="pdf-viewer">
      <div className="pdf-viewer-header" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span>PDF Viewer</span>
        {selectedNode && (
          <>
            <span className="pdf-viewer-badge">
              {selectedNode.label} · p.{page}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
              
              <button
                onClick={handleTTS}
                disabled={isReading}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  background: isPlaying ? '#e06c75' : '#4ec9a0',
                  color: 'black',
                  cursor: isReading ? 'not-allowed' : 'pointer',
                  fontSize: '12px',
                  fontWeight: 'bold'
                }}
              >
                {isReading ? 'Loading...' : isPlaying ? 'Stop' : 'Read Aloud'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* 3. The Viewer must be wrapped in a Worker so it doesn't freeze the UI */}
      <div className="pdf-iframe" style={{ overflow: 'hidden' }}>
        <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js">
          <Viewer
            fileUrl={`file://${pdfPath}`}
            plugins={[pageNavigationPluginInstance]}
            initialPage={page - 1} // zero-indexed
          />
        </Worker>
      </div>
    </aside>
  )
}
