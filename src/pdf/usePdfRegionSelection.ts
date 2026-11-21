import { useEffect, useState, type RefObject } from 'react'
import type { PDFPageView, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import type { PdfRegion, PdfRegionMode } from './pdfRegion'

type Outline = { left: number; top: number; width: number; height: number }

export function usePdfRegionSelection(
  pdfId: string,
  mode: PdfRegionMode | null,
  container: RefObject<HTMLDivElement | null>,
  viewerRef: RefObject<PDFViewer | null>,
) {
  const [region, setRegion] = useState<PdfRegion | null>(null)
  const [outline, setOutline] = useState<Outline | null>(null)

  useEffect(() => {
    setRegion(null)
    setOutline(null)
    const surface = container.current
    const viewer = viewerRef.current
    if (!mode || !surface || !viewer) return

    const controller = new AbortController()
    const { signal } = controller
    let draft: PdfRegion | null = null
    let drag: { id: number; pageNumber: number; rotation: number; x: number; y: number } | null = null

    function pageGeometry(pageNumber: number) {
      const page = viewer!.getPageView(pageNumber - 1) as PDFPageView | undefined
      if (!page?.pdfPage) return
      // PDF.js lays out this wrapper inside the page border.
      const bounds = page.div.querySelector('.canvasWrapper')?.getBoundingClientRect()
      if (!bounds?.width || !bounds.height) return
      return { bounds, viewport: page.viewport }
    }

    function pdfPoint(event: PointerEvent, geometry: NonNullable<ReturnType<typeof pageGeometry>>) {
      const { bounds, viewport } = geometry
      const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
      const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
      return viewport.convertToPdfPoint(x * viewport.width, y * viewport.height)
    }

    function projectedOutline(): Outline | null {
      if (!draft) return null
      const geometry = pageGeometry(draft.pageNumber)
      if (!geometry) return null
      const { bounds, viewport } = geometry
      const [x1, y1] = viewport.convertToViewportPoint(draft.xMin, draft.yMin)
      const [x2, y2] = viewport.convertToViewportPoint(draft.xMax, draft.yMax)
      const origin = surface!.getBoundingClientRect()
      const sx = bounds.width / viewport.width
      const sy = bounds.height / viewport.height
      return {
        left: bounds.left - origin.left + Math.min(x1, x2) * sx,
        top: bounds.top - origin.top + Math.min(y1, y2) * sy,
        width: Math.abs(x2 - x1) * sx,
        height: Math.abs(y2 - y1) * sy,
      }
    }

    function redraw() {
      setOutline(projectedOutline())
    }

    function onDown(event: PointerEvent) {
      if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return
      const pageNumber = Number(event.target.closest('.page[data-page-number]')?.getAttribute('data-page-number'))
      const geometry = pageGeometry(pageNumber)
      if (!geometry) return
      const { bounds, viewport } = geometry
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) return
      event.stopPropagation()
      surface!.setPointerCapture(event.pointerId)
      const [x, y] = pdfPoint(event, geometry)
      drag = { id: event.pointerId, pageNumber, rotation: viewport.rotation, x, y }
      draft = null
      setRegion(null)
      redraw()
    }

    function onMove(event: PointerEvent) {
      if (!drag || drag.id !== event.pointerId) return
      const geometry = pageGeometry(drag.pageNumber)
      if (!geometry) return
      const [x, y] = pdfPoint(event, geometry)
      draft = {
        pdfId,
        pageNumber: drag.pageNumber,
        rotation: drag.rotation,
        xMin: Math.min(drag.x, x),
        yMin: Math.min(drag.y, y),
        xMax: Math.max(drag.x, x),
        yMax: Math.max(drag.y, y),
      }
      redraw()
    }

    function onUp(event: PointerEvent) {
      if (drag?.id !== event.pointerId) return
      onMove(event)
      const box = projectedOutline()
      if (!box || box.width < 4 || box.height < 4) draft = null
      drag = null
      setRegion(draft)
      redraw()
    }

    function onCancel(event: PointerEvent) {
      if (drag?.id !== event.pointerId) return
      drag = null
      draft = null
      redraw()
    }

    surface.addEventListener('pointerdown', onDown, { capture: true, signal })
    surface.addEventListener('pointermove', onMove, { signal })
    surface.addEventListener('pointerup', onUp, { signal })
    surface.addEventListener('pointercancel', onCancel, { signal })
    surface.addEventListener('lostpointercapture', onCancel, { signal })
    surface.addEventListener('scroll', redraw, { signal })
    viewer.eventBus.on('scalechanging', redraw, { signal })
    viewer.eventBus.on('pagerendered', redraw, { signal })
    const resize = new ResizeObserver(redraw)
    resize.observe(surface)

    return () => {
      controller.abort()
      resize.disconnect()
      if (drag && surface.hasPointerCapture(drag.id)) surface.releasePointerCapture(drag.id)
    }
  }, [pdfId, mode, container, viewerRef])

  return mode ? { region, outline } : { region: null, outline: null }
}
