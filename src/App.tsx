import { lazy, Suspense, useRef, useState, type PointerEvent } from 'react'
import CardWorkspace from './cards/CardWorkspace'
import './App.css'

const PdfWorkspace = lazy(() => import('./pdf/PdfWorkspace'))
const MIN_PDF_WIDTH = 20
const MAX_PDF_WIDTH = 80

function clampWidth(width: number) {
  return Math.min(MAX_PDF_WIDTH, Math.max(MIN_PDF_WIDTH, width))
}

export default function App() {
  const [pdfWidth, setPdfWidth] = useState(50)
  const layout = useRef<HTMLDivElement>(null)
  const grabOffset = useRef(0)

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return

    const divider = event.currentTarget
    grabOffset.current = event.clientX - divider.getBoundingClientRect().left
    divider.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    const divider = event.currentTarget
    if (!divider.hasPointerCapture(event.pointerId)) return

    const bounds = layout.current!.getBoundingClientRect()
    const paneWidth = bounds.width - divider.offsetWidth
    if (paneWidth <= 0) return

    const width = event.clientX - bounds.left - grabOffset.current
    setPdfWidth(clampWidth((width / paneWidth) * 100))
  }

  return (
    <div
      className="split-workspace"
      ref={layout}
      style={{ gridTemplateColumns: `minmax(0, ${pdfWidth}fr) auto minmax(0, ${100 - pdfWidth}fr)` }}
    >
      <div className="workspace-pane" id="pdf-pane">
        <Suspense fallback={<p role="status">正在加载 PDF 阅读器…</p>}>
          <PdfWorkspace />
        </Suspense>
      </div>
      <div
        className="workspace-divider"
        role="separator"
        tabIndex={0}
        aria-label="调整 PDF 和 Card 栏宽"
        aria-orientation="vertical"
        aria-controls="pdf-pane"
        aria-valuemin={MIN_PDF_WIDTH}
        aria-valuemax={MAX_PDF_WIDTH}
        aria-valuenow={Math.round(pdfWidth)}
        onPointerDown={startResize}
        onPointerMove={resize}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          event.stopPropagation()
          const delta = event.key === 'ArrowLeft' ? -5 : 5
          setPdfWidth((width) => clampWidth(width + delta))
        }}
      />
      <div className="workspace-pane">
        <CardWorkspace />
      </div>
    </div>
  )
}
