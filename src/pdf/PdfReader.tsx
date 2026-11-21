import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { AnnotationEditorType, AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { EventBus, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import 'pdfjs-dist/legacy/web/pdf_viewer.css'
import { acquirePdfDocument } from './pdfDocument'
import type { PdfRegion, PdfRegionMode } from './pdfRegion'
import { usePdfRegionSelection } from './usePdfRegionSelection'

type PdfReaderProps = {
  id: string
  selectionMode: PdfRegionMode | null
  onStartSelection: () => void
  onCancelSelection: () => void
  onConfirmRegion: (region: PdfRegion) => void
}

function tapAction(event: PointerEvent<HTMLButtonElement>, action: () => void) {
  if (event.pointerType !== 'touch' || !event.isPrimary) return
  const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect()
  if (event.clientX >= left && event.clientX <= right && event.clientY >= top && event.clientY <= bottom) {
    action()
  }
}

export default function PdfReader({
  id, selectionMode, onStartSelection, onCancelSelection, onConfirmRegion,
}: PdfReaderProps) {
  const container = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PDFViewer | null>(null)
  const [scale, setScale] = useState<number | null>(null)
  const [error, setError] = useState('')
  const confirmedRegion = useRef<PdfRegion | null>(null)

  useEffect(() => {
    const element = container.current!
    const controller = new AbortController()
    const { signal } = controller
    const eventBus = new EventBus()
    const options = {
      container: element,
      eventBus,
      abortSignal: signal,
      annotationMode: AnnotationMode.DISABLE,
      annotationEditorMode: AnnotationEditorType.DISABLE,
      enablePermissions: true,
      enableAutoLinking: false,
      maxCanvasPixels: 4_194_304,
      maxCanvasDim: 4096,
      enableDetailCanvas: false,
    }
    const viewer = new PDFViewer(options)
    viewerRef.current = viewer

    function fitWidth() {
      viewer.currentScaleValue = 'page-width'
    }

    eventBus.on('pagesinit', fitWidth, { signal })
    eventBus.on('scalechanging', ({ scale }: { scale: number }) => setScale(scale), { signal })
    eventBus.on('pagerendered', ({ error, pageNumber }: { error?: Error; pageNumber: number }) => {
      if (error) setError(`无法显示第 ${pageNumber} 页。`)
    }, { signal })

    const resize = new ResizeObserver(() => {
      if (viewer.currentScaleValue === 'page-width') fitWidth()
    })
    resize.observe(element)

    const source = acquirePdfDocument(id)
    async function showDocument() {
      try {
        const pdf = await source.promise
        if (signal.aborted) return
        viewer.setDocument(pdf)
        await viewer.pagesPromise
      } catch (error) {
        if (!signal.aborted) {
          console.error('Could not open the PDF', error)
          setError('无法打开 PDF，请检查文件或重新打开阅读视图。')
        }
      }
    }
    void showDocument()

    return () => {
      viewer.setDocument(null)
      controller.abort()
      resize.disconnect()
      viewerRef.current = null
      source.release()
    }
  }, [id])

  const { region, outline } = usePdfRegionSelection(id, selectionMode, container, viewerRef)

  function confirm(region: PdfRegion) {
    // A touch release can be followed by a synthesized click.
    if (confirmedRegion.current === region) return
    confirmedRegion.current = region
    onConfirmRegion(region)
  }

  return (
    <div className="pdf-reader">
      <div className="pdf-bar">
        <button type="button" aria-label="缩小" disabled={scale === null} onClick={() => viewerRef.current?.decreaseScale()}>−</button>
        <button type="button" aria-label="放大" disabled={scale === null} onClick={() => viewerRef.current?.increaseScale()}>+</button>
        <button
          type="button"
          disabled={scale === null}
          onClick={() => {
            if (viewerRef.current) viewerRef.current.currentScaleValue = 'page-width'
          }}
        >
          适应宽度
        </button>
        {scale !== null && <span aria-label="缩放比例">{Math.round(scale * 100)}%</span>}
        <button type="button" disabled={scale === null} aria-pressed={selectionMode === 'create'} onClick={onStartSelection}>
          选区
        </button>
        {selectionMode && (
          <>
            {region ? (
              <button
                type="button"
                onClick={() => confirm(region)}
                onPointerUp={(event) => tapAction(event, () => confirm(region))}
              >
                {selectionMode === 'create' ? '创建 Card' : '插入当前 Card'}
              </button>
            ) : <span role="status">在单页内拖动选区</span>}
            <button
              type="button"
              onClick={onCancelSelection}
              onPointerUp={(event) => tapAction(event, onCancelSelection)}
            >
              取消选区
            </button>
          </>
        )}
        {error ? <span role="alert">{error}</span> : scale === null && <span role="status">正在打开 PDF…</span>}
      </div>
      <div className="pdf-scroll-area">
        <div
          className="pdf-scroll"
          data-selecting={selectionMode ? '' : undefined}
          ref={container}
          role="region"
          aria-label="PDF 页面"
          tabIndex={0}
        >
          <div className="pdfViewer" />
        </div>
        {outline && <div className="pdf-region-outline" style={outline} aria-hidden="true" />}
      </div>
    </div>
  )
}
