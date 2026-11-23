import { useEffect, useRef, useState, type ComponentType, type PointerEvent } from 'react'
import { READING_CHECKPOINT, type PdfView } from '../workspace/workspaceStorage'
import WorkspaceIcon from '../WorkspaceIcon'
import { AnnotationEditorType, AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { EventBus, LinkTarget, PDFFindController, PDFLinkService, PDFViewer, type PDFPageView } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import 'pdfjs-dist/legacy/web/pdf_viewer.css'
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
import { acquirePdfDocument, pdfAssetUrl } from './pdfDocument'
import type { PdfRegion, PdfRegionMode, PdfRegionReference } from './pdfRegion'
import PdfRegionMarks from './PdfRegionMarks'
import { usePdfRegionSelection } from './usePdfRegionSelection'

export type PdfViewerSession = { viewer: PDFViewer; document: PDFDocumentProxy; links: PDFLinkService }

export type PdfReaderProps = {
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
  id, workspaceId, initialView, onReadingChange, selectionMode, onStartSelection, onCancelSelection, onConfirmRegion, references, destination, onOpenCard, ViewerTools,
}: PdfReaderProps & { ViewerTools?: ComponentType<{ session: PdfViewerSession; selecting: boolean }> }) {
  const container = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PDFViewer | null>(null)
  const [scale, setScale] = useState<number | null>(null)
  const [session, setSession] = useState<PdfViewerSession | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const confirmedRegion = useRef<PdfRegion | null>(null)
  const initial = useRef({ view: initialView, destination })

  useEffect(() => {
    const element = container.current!
    const controller = new AbortController()
    const { signal } = controller
    const eventBus = new EventBus()
    const links = ViewerTools ? new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK }) : undefined
    const options = {
      container: element,
      eventBus,
      abortSignal: signal,
      linkService: links,
      findController: links ? new PDFFindController({ eventBus, linkService: links }) : undefined,
      annotationMode: links ? AnnotationMode.ENABLE : AnnotationMode.DISABLE,
      imageResourcesPath: pdfAssetUrl + 'images/',
      annotationEditorMode: AnnotationEditorType.DISABLE,
      enablePermissions: true,
      enableAutoLinking: false,
      maxCanvasPixels: 4_194_304,
      maxCanvasDim: 4096,
      enableDetailCanvas: !!ViewerTools,
    }
    const viewer = new PDFViewer(options)
    viewerRef.current = viewer
    links?.setViewer(viewer)

    const { view: saved, destination: initialDestination } = initial.current
    const savedScale = saved?.scale ?? 'page-width'
    let restored = false
    let latest: PdfView | undefined
    let saveTimer: number | undefined
    function flushView() {
      window.clearTimeout(saveTimer)
      saveTimer = undefined
      if (latest) onReadingChange(id, latest)
    }
    function scrollToView({ page, left, top }: PdfView) {
      viewer.scrollPageIntoView({
        pageNumber: page, destArray: [null, { name: 'XYZ' }, left, top, null],
        ignoreDestinationZoom: true, allowNegativeOffset: true,
      })
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
      const scale = viewer.currentScaleValue
      let { pageNumber: page, left, top } = location
      // PDF.js reports the first partly visible page as the scroll anchor. Keep the
      // current page when it differs, using the same origin in that page's coordinates.
      const current = viewer.currentPageNumber
      const currentView: PDFPageView | undefined = viewer.getPageView(current - 1)
      if (current !== page && currentView?.pdfPage) {
        const { div } = currentView
        page = current
        const point = currentView.getPagePoint(
          element.scrollLeft - div.offsetLeft - div.clientLeft,
          element.scrollTop - div.offsetTop - div.clientTop,
        )
        left = point[0]
        top = point[1]
      }
      latest = {
        page,
        left: Math.round(left),
        top: Math.round(top),
        scale: scale === 'page-width' || scale === 'page-fit' ? scale : viewer.currentScale,
        ...(viewer.pagesRotation ? { rotation: viewer.pagesRotation } : {}),
        at: Date.now(),
      }
      if (saveTimer === undefined) saveTimer = window.setTimeout(flushView, 650)
    }, { signal })
    eventBus.on('pagesinit', () => {
      if (saved?.rotation) viewer.pagesRotation = saved.rotation
      viewer.currentScaleValue = String(savedScale)
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
        const scale = viewer.currentScaleValue
        if (scale === 'page-width' || scale === 'page-fit') {
          const position = latest
          const previousScale = viewer.currentScale
          viewer.currentScaleValue = scale
          if (position && previousScale !== viewer.currentScale) scrollToView(position)
        }
        viewer.update()
      }, 100)
    })
    resize.observe(element)

    const source = acquirePdfDocument(id)
    async function showDocument() {
      try {
        const pdf = await source.promise
        if (signal.aborted) return
        links?.setDocument(pdf)
        viewer.setDocument(pdf)
        await viewer.pagesPromise
        if (signal.aborted) return
        if (saved && !initialDestination && saved.page <= pdf.numPages) {
          // With lazy page initialization, the placeholder viewport may have the first page's size/rotation.
          const page = await pdf.getPage(saved.page)
          if (signal.aborted) return
          const pageView: PDFPageView | undefined = viewer.getPageView(saved.page - 1)
          if (pageView && !pageView.pdfPage) pageView.setPdfPage(page)
          viewer.currentPageNumber = saved.page
          viewer.currentScaleValue = String(savedScale)
          scrollToView(saved)
        }
        restored = true
        viewer.update()
        setReady(true)
        if (links) setSession({ viewer, document: pdf, links })
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
      links?.setDocument(null)
      resize.disconnect()
      window.clearTimeout(fitTimer)
      viewerRef.current = null
      source.release()
    }
  }, [id, workspaceId, ViewerTools])

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
            disabled={!ready} onClick={() => viewerRef.current?.decreaseScale()}>
            <WorkspaceIcon name="minus" />
          </button>
          <span className="zoom-value" aria-label="缩放比例">{scale === null ? '—' : `${Math.round(scale * 100)}%`}</span>
          <button type="button" className="tool-button" aria-label="放大" title="放大"
            disabled={!ready} onClick={() => viewerRef.current?.increaseScale()}>
            <WorkspaceIcon name="plus" />
          </button>
          <button type="button" className="tool-button fit-tool" aria-label="适应宽度" title="适应宽度"
            disabled={!ready} onClick={() => {
              if (viewerRef.current) viewerRef.current.currentScaleValue = 'page-width'
            }}>
            <WorkspaceIcon name="fit" />
          </button>
        </div>
        <button type="button" className="tool-button selection-tool" aria-label="选区" title="选区"
          disabled={!ready} aria-pressed={selectionMode !== null} onClick={onStartSelection}>
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
        {error ? <span role="alert">{error}</span> : !ready && <span role="status">正在打开 PDF…</span>}
      </div>
      {ViewerTools && session && <ViewerTools session={session} selecting={selectionMode !== null} />}
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
          ready={ready}
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
