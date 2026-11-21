export type PdfRegion = {
  pdfId: string
  pageNumber: number
  xMin: number
  yMin: number
  xMax: number
  yMax: number
  rotation: number
}

export type PdfRegionMode = 'create' | 'insert'

export function regionSize(region: PdfRegion) {
  const width = region.xMax - region.xMin
  const height = region.yMax - region.yMin
  return region.rotation % 180 === 0 ? { width, height } : { width: height, height: width }
}
