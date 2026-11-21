import type { PDFPageView, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import type { PdfRegion } from './pdfRegion'

export function pdfPageGeometry(viewer: PDFViewer, pageNumber: number) {
  const page = viewer.getPageView(pageNumber - 1) as PDFPageView | undefined
  if (!page?.pdfPage) return
  // PDF.js lays out this wrapper inside the page border.
  const bounds = page.div.querySelector('.canvasWrapper')?.getBoundingClientRect()
  if (!bounds?.width || !bounds.height) return
  return { bounds, viewport: page.viewport }
}

export type PdfPageGeometry = NonNullable<ReturnType<typeof pdfPageGeometry>>

export function projectPdfRegion(region: PdfRegion, geometry: PdfPageGeometry, origin: DOMRect) {
  const { bounds, viewport } = geometry
  const [x1, y1] = viewport.convertToViewportPoint(region.xMin, region.yMin)
  const [x2, y2] = viewport.convertToViewportPoint(region.xMax, region.yMax)
  const sx = bounds.width / viewport.width
  const sy = bounds.height / viewport.height
  return {
    left: bounds.left - origin.left + Math.min(x1, x2) * sx,
    top: bounds.top - origin.top + Math.min(y1, y2) * sy,
    width: Math.abs(x2 - x1) * sx,
    height: Math.abs(y2 - y1) * sy,
  }
}
