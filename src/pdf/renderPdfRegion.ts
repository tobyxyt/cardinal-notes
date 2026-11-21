import { AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { acquirePdfDocument } from './pdfDocument'
import type { PdfRegion } from './pdfRegion'

const MAX_CACHED_REGIONS = 6
const renderedRegions = new Map<string, Promise<HTMLCanvasElement>>()

export function renderPdfRegion(region: PdfRegion, edge: number) {
  const { pdfId, pageNumber, rotation, xMin, yMin, xMax, yMax } = region
  const key = JSON.stringify([pdfId, pageNumber, rotation, xMin, yMin, xMax, yMax, edge])
  const cached = renderedRegions.get(key)
  if (cached) {
    renderedRegions.delete(key)
    renderedRegions.set(key, cached)
    return cached
  }

  const result = render(region, edge)
  renderedRegions.set(key, result)
  if (renderedRegions.size > MAX_CACHED_REGIONS) {
    const oldest = renderedRegions.keys().next().value
    if (oldest !== undefined) renderedRegions.delete(oldest)
  }
  void result.catch(() => {
    if (renderedRegions.get(key) === result) renderedRegions.delete(key)
  })
  return result
}

async function render(region: PdfRegion, edge: number) {
  const source = acquirePdfDocument(region.pdfId)
  try {
    const pdf = await source.promise
    const page = await pdf.getPage(region.pageNumber)
    const { rotation, xMin, yMin, xMax, yMax } = region
    const base = page.getViewport({ scale: 1, rotation })
    const [x1, y1] = base.convertToViewportPoint(xMin, yMin)
    const [x2, y2] = base.convertToViewportPoint(xMax, yMax)
    const width = Math.abs(x2 - x1)
    const height = Math.abs(y2 - y1)
    if (!(width > 0 && height > 0)) throw new Error('Invalid PDF region')

    const scale = edge / Math.max(width, height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(width * scale))
    canvas.height = Math.max(1, Math.ceil(height * scale))
    await page.render({
      canvas,
      viewport: page.getViewport({ scale, rotation }),
      // Place the original PDF origin outside the crop's canvas.
      transform: [1, 0, 0, 1, -Math.min(x1, x2) * scale, -Math.min(y1, y2) * scale],
      annotationMode: AnnotationMode.DISABLE,
      background: '#fff',
    }).promise
    return canvas
  } finally {
    source.release()
  }
}
