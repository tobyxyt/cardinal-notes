import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { READING_CHECKPOINT, type PdfView } from '../workspace/workspaceStorage'
import WorkspaceIcon from '../WorkspaceIcon'
import { AnnotationEditorType, AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { EventBus, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import 'pdfjs-dist/legacy/web/pdf_viewer.css'
import { acquirePdfDocument } from './pdfDocument'
import type { PdfRegion, PdfRegionMode, PdfRegionReference } from './pdfRegion'
import PdfRegionMarks from './PdfRegionMarks'
import { usePdfRegionSelection } from './usePdfRegionSelection'

type PdfReaderProps = {
  id: string
  workspaceId: string
  initialView?: PdfView
  onReadingChange: (pdfId: string, view: PdfView) => void
  selectionMode: PdfRegionMode | null
  onStartSelection: () => void
  onCancelSelection: () => void
  onConfirmRegion: (region: PdfRegion) => void
  references: PdfRegionReference[]
  destination: PdfRegion | null
  onOpenCard: (cardId: string) => void
}

function tapAction(event: PointerEvent<HTMLButtonElement>, action: () => void) {
  if (event.pointerType !== 'touch' || !event.isPrimary) return
  const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect()
  if (event.clientX >= left && event.clientX <= right && event.clientY >= top && event.clientY <= bottom) {
    action()
  }
}

export default function PdfReader({
  id, workspaceId, initialView, onReadingChange, selectionMode, onStartSelection, onCancelSelection, onConfirmRegion, references, destination, onOpenCard,
}: PdfReaderProps) {
  const container = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PDFViewer | null>(null)
  const [scale, setScale] = useState<number | null>(null)
  const [error, setError] = useState('')
  const confirmedRegion = useRef<PdfRegion | null>(null)
  const initial = useRef(initialView)

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

    const saved = initial.current
    let restored = !saved
    let latest: PdfView | undefined
    let saveTimer: number | undefined
    function flushView() {
      window.clearTimeout(saveTimer)
      saveTimer = undefined
      if (latest) onReadingChange(id, latest)
    }
    function checkpoint() {
      if (!latest) return
      try {
        sessionStorage.setItem(READING_CHECKPOINT, JSON.stringify({ workspaceId, pdfId: id, view: latest }))
      } catch { /* the regular workspace save still applies */ }
      flushView()
    }
    window.addEventListener('pagehide', checkpoint, { signal })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') checkpoint()
    }, { signal })
    eventBus.on('updateviewarea', ({ location }: { location: { pageNumber: number; left: number; top: number } }) => {
      if (!restored) return
      latest = {
        page: location.pageNumber,
        left: Math.round(location.left),
        top: Math.round(location.top),
        scale: viewer.currentScaleValue === 'page-width' ? 'page-width' : viewer.currentScale,
        at: Date.now(),
      }
      if (saveTimer === undefined) saveTimer = window.setTimeout(flushView, 650)
    }, { signal })
    eventBus.on('pagesinit', () => {
      if (saved && typeof saved.scale === 'number') viewer.currentScale = saved.scale
      else fitWidth()
    }, { signal })
    eventBus.on('scalechanging', ({ scale }: { scale: number }) => setScale(scale), { signal })
    eventBus.on('pagerendered', ({ error, pageNumber }: { error?: Error; pageNumber: number }) => {
      if (error) setError(`无法显示第 ${pageNumber} 页。`)
    }, { signal })

    // Fit once resizing settles instead of recalculating page scales for every drag frame.
    let fitTimer: number | undefined
    const resize = new ResizeObserver(() => {
      window.clearTimeout(fitTimer)
      fitTimer = window.setTimeout(() => {
        if (viewer.currentScaleValue === 'page-width') fitWidth()
      }, 100)
    })
    resize.observe(element)

    const source = acquirePdfDocument(id)
    async function showDocument() {
      try {
        const pdf = await source.promise
        if (signal.aborted) return
        viewer.setDocument(pdf)
        await viewer.pagesPromise
        if (signal.aborted || !saved) return
        if (saved.page <= pdf.numPages) {
          viewer.scrollPageIntoView({
            pageNumber: saved.page, destArray: [null, { name: 'XYZ' }, saved.left, saved.top, null],
            ignoreDestinationZoom: true, allowNegativeOffset: true,
          })
        }
        restored = true
      } catch (error) {
        if (!signal.aborted) {
          console.error('Could not open the PDF', error)
          setError('无法打开 PDF，请检查文件或重新打开阅读视图。')
        }
      }
    }
    void showDocument()

    return () => {
      flushView()
      controller.abort()
      viewer.setDocument(null)
      resize.disconnect()
      window.clearTimeout(fitTimer)
      viewerRef.current = null
      source.release()
    }
  }, [id, workspaceId])

  const { region, outline } = usePdfRegionSelection(id, selectionMode, container, viewerRef)

  function confirm(region: PdfRegion) {
    // A touch release can be followed by a synthesized click.
    if (confirmedRegion.current === region) return
    confirmedRegion.current = region
    onConfirmRegion(region)
  }

  return (
    <div className="pdf-reader">
      <div className="pdf-tools">
        <div className="zoom-tools" role="group" aria-label="页面缩放">
          <button type="button" className="tool-button" aria-label="缩小" title="缩小"
            disabled={scale === null} onClick={() => viewerRef.current?.decreaseScale()}>
            <WorkspaceIcon name="minus" />
          </button>
          <span className="zoom-value" aria-label="缩放比例">{scale === null ? '—' : `${Math.round(scale * 100)}%`}</span>
          <button type="button" className="tool-button" aria-label="放大" title="放大"
            disabled={scale === null} onClick={() => viewerRef.current?.increaseScale()}>
            <WorkspaceIcon name="plus" />
          </button>
          <button type="button" className="tool-button fit-tool" aria-label="适应宽度" title="适应宽度"
            disabled={scale === null} onClick={() => {
              if (viewerRef.current) viewerRef.current.currentScaleValue = 'page-width'
            }}>
            <WorkspaceIcon name="fit" />
          </button>
        </div>
        <button type="button" className="tool-button selection-tool" aria-label="选区" title="选区"
          disabled={scale === null} aria-pressed={selectionMode !== null} onClick={onStartSelection}>
          <WorkspaceIcon name="select" />
          <span>选区</span>
        </button>
        {selectionMode && (
          <div className="selection-actions">
            {region ? (
              <button
                type="button"
                className="text-button primary-tool"
                onClick={() => confirm(region)}
                onPointerUp={(event) => tapAction(event, () => confirm(region))}
              >
                {selectionMode === 'create' ? '创建 Card' : '插入当前 Card'}
              </button>
            ) : <span role="status">在单页内拖动选区</span>}
            <button
              type="button"
              className="text-button"
              onClick={onCancelSelection}
              onPointerUp={(event) => tapAction(event, onCancelSelection)}
            >
              取消选区
            </button>
          </div>
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
        <PdfRegionMarks
          references={references}
          destination={destination}
          ready={scale !== null}
          selecting={selectionMode !== null}
          surfaceRef={container}
          viewerRef={viewerRef}
          onOpenCard={onOpenCard}
        />
        {outline && <div className="pdf-region-outline" style={outline} aria-hidden="true" />}
      </div>
    </div>
  )
}
