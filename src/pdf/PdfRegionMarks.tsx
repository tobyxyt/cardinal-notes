import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import type { PdfRegion, PdfRegionReference } from './pdfRegion'
import { pdfPageGeometry, projectPdfRegion, type PdfPageGeometry } from './pdfRegionGeometry'

type Marker = { key: string; region: PdfRegion; cards: Map<string, string> }
type Position = ReturnType<typeof projectPdfRegion>
type PositionedMarker = { marker: Marker; position: Position }

type Props = {
  references: PdfRegionReference[]
  destination: PdfRegion | null
  ready: boolean
  selecting: boolean
  surfaceRef: RefObject<HTMLDivElement | null>
  viewerRef: RefObject<PDFViewer | null>
  onOpenCard: (cardId: string) => void
}

export default function PdfRegionMarks({
  references, destination, ready, selecting, surfaceRef, viewerRef, onOpenCard,
}: Props) {
  const markers = useMemo(() => {
    const grouped = new Map<string, Marker>()
    for (const { cardId, cardTitle, region } of references) {
      const { pageNumber, xMin, yMin, xMax, yMax } = region
      const key = [pageNumber, xMin, yMin, xMax, yMax].join(':')
      let marker = grouped.get(key)
      if (!marker) grouped.set(key, marker = { key, region, cards: new Map() })
      marker.cards.set(cardId, cardTitle)
    }
    return grouped
  }, [references])
  const [visible, setVisible] = useState<PositionedMarker[]>([])
  const [highlight, setHighlight] = useState<PdfRegion | null>(null)
  const [highlightPosition, setHighlightPosition] = useState<Position | null>(null)
  const [chooser, setChooser] = useState<string | null>(null)

  useEffect(() => setChooser(null), [selecting, destination])

  useEffect(() => {
    const surface = surfaceRef.current
    const viewer = viewerRef.current
    setHighlight(null)
    if (!destination || !ready || !surface || !viewer) return

    const controller = new AbortController()
    let done = false
    let timeout: number | undefined
    function locate() {
      if (done) return true
      const geometry = pdfPageGeometry(viewer!, destination!.pageNumber)
      if (!geometry) return false
      done = true
      const rect = projectPdfRegion(destination!, geometry, surface!.getBoundingClientRect())
      surface!.scrollBy({
        left: rect.left + rect.width / 2 - surface!.clientWidth / 2,
        top: rect.top + rect.height / 2 - surface!.clientHeight / 2,
        behavior: 'instant',
      })
      setHighlight(destination)
      timeout = window.setTimeout(() => setHighlight(null), 3200)
      return true
    }

    if (!locate()) {
      viewer.eventBus.on('pagerendered', ({ pageNumber }: { pageNumber: number }) => {
        if (pageNumber === destination.pageNumber) locate()
      }, { signal: controller.signal })
      viewer.scrollPageIntoView({ pageNumber: destination.pageNumber })
    }
    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [destination, ready, surfaceRef, viewerRef])

  useEffect(() => {
    const surface = surfaceRef.current
    const viewer = viewerRef.current
    if (!ready || !surface || !viewer || (!markers.size && !highlight)) {
      setVisible([])
      setHighlightPosition(null)
      return
    }

    const controller = new AbortController()
    const { signal } = controller
    let frame = 0
    function refresh() {
      frame = 0
      const origin = surface!.getBoundingClientRect()
      const geometries = new Map<number, PdfPageGeometry | undefined>()
      function project(region: PdfRegion) {
        if (!geometries.has(region.pageNumber)) {
          geometries.set(region.pageNumber, pdfPageGeometry(viewer!, region.pageNumber))
        }
        const geometry = geometries.get(region.pageNumber)
        if (!geometry || geometry.bounds.bottom < origin.top || geometry.bounds.top > origin.bottom) return null
        const rect = projectPdfRegion(region, geometry, origin)
        if (rect.top + rect.height <= 0 || rect.top >= origin.height ||
            rect.left + rect.width <= 0 || rect.left >= origin.width) return null
        return rect
      }
      setVisible([...markers.values()].flatMap((marker) => {
        const position = project(marker.region)
        return position ? [{ marker, position }] : []
      }))
      setHighlightPosition(highlight ? project(highlight) : null)
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(refresh)
    }

    surface.addEventListener('scroll', schedule, { signal })
    for (const name of ['scalechanging', 'rotationchanging', 'pagerendered', 'pagesloaded']) {
      viewer.eventBus.on(name, schedule, { signal })
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(surface)
    refresh()
    return () => {
      controller.abort()
      resize.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [markers, highlight, ready, surfaceRef, viewerRef])

  const choices = chooser && !selecting ? markers.get(chooser)?.cards : undefined

  return (
    <>
      {visible.map(({ marker, position }) => (
        <div key={marker.key} className="pdf-history-mark" style={position}>
          {!selecting && (
            <button
              type="button"
              className="pdf-history-open"
              aria-label={marker.cards.size === 1 ? `打开 Card：${marker.cards.values().next().value}` : '选择引用此选区的 Card'}
              title={Array.from(marker.cards.values()).join('、')}
              onClick={() => {
                if (marker.cards.size === 1) {
                  setChooser(null)
                  onOpenCard(marker.cards.keys().next().value!)
                } else setChooser(marker.key)
              }}
            >
              ↗
            </button>
          )}
        </div>
      ))}
      {highlightPosition && <div className="pdf-jump-highlight" style={highlightPosition} aria-hidden="true" />}
      {choices && choices.size > 1 && (
        <div className="pdf-history-choices" role="group" aria-label="引用此选区的 Card">
          {[...choices].map(([id, title]) => (
            <button key={id} type="button" onClick={() => { setChooser(null); onOpenCard(id) }}>{title}</button>
          ))}
          <button type="button" onClick={() => setChooser(null)}>关闭</button>
        </div>
      )}
    </>
  )
}
