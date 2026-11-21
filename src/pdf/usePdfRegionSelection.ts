import { useEffect, useState, type RefObject } from 'react'
import type { PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import type { PdfRegion, PdfRegionMode } from './pdfRegion'

import { pdfPageGeometry, projectPdfRegion, type PdfPageGeometry } from './pdfRegionGeometry'

type Outline = ReturnType<typeof projectPdfRegion>

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

    function pdfPoint(event: PointerEvent, geometry: PdfPageGeometry) {
      const { bounds, viewport } = geometry
      const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
      const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
      return viewport.convertToPdfPoint(x * viewport.width, y * viewport.height)
    }

    function projectedOutline(): Outline | null {
      if (!draft) return null
      const geometry = pdfPageGeometry(viewer!, draft.pageNumber)
      return geometry ? projectPdfRegion(draft, geometry, surface!.getBoundingClientRect()) : null
    }

    function redraw() {
      setOutline(projectedOutline())
    }

    function onDown(event: PointerEvent) {
      if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return
      const pageNumber = Number(event.target.closest('.page[data-page-number]')?.getAttribute('data-page-number'))
      const geometry = pdfPageGeometry(viewer!, pageNumber)
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
      const geometry = pdfPageGeometry(viewer!, drag.pageNumber)
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
    viewer.eventBus.on('rotationchanging', redraw, { signal })
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
