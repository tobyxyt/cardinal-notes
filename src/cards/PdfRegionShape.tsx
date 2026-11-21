import { useEffect, useRef, useState } from 'react'
import {
  BaseBoxShapeUtil, createShapeId, HTMLContainer, resizeBox, T, useValue,
  type Editor, type TLResizeInfo, type TLShape,
} from 'tldraw'
import { regionSize, type PdfRegion } from '../pdf/pdfRegion'
import './PdfRegionShape.css'

const PDF_REGION = 'pdf-region'

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    [PDF_REGION]: PdfRegion & { w: number; h: number }
  }
}

type PdfRegionShape = TLShape<typeof PDF_REGION>

function RegionCanvas({ region, edge }: { region: PdfRegion; edge: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const { pdfId, pageNumber, rotation, xMin, yMin, xMax, yMax } = region

  useEffect(() => {
    const canvas = ref.current!
    let cancelled = false
    async function paint() {
      try {
        const { renderPdfRegion } = await import('../pdf/renderPdfRegion')
        if (cancelled) return
        const result = await renderPdfRegion({ pdfId, pageNumber, rotation, xMin, yMin, xMax, yMax }, edge)
        if (cancelled) return
        canvas.width = result.width
        canvas.height = result.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas unavailable')
        context.drawImage(result, 0, 0)
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }
    void paint()
    return () => { cancelled = true }
  }, [pdfId, pageNumber, rotation, xMin, yMin, xMax, yMax, edge])

  return (
    <>
      <canvas ref={ref} hidden={status !== 'ready'} aria-label={`PDF 第 ${pageNumber} 页选区`} />
      {status !== 'ready' && (
        <div className="pdf-region-status" role="status">
          {status === 'error' ? '源 PDF 缺失或无法加载' : '正在加载 PDF 选区…'}
        </div>
      )}
    </>
  )
}

export class PdfRegionShapeUtil extends BaseBoxShapeUtil<PdfRegionShape> {
  static override type = PDF_REGION
  static override props = {
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
    pdfId: T.string,
    pageNumber: T.positiveInteger,
    rotation: T.number,
    xMin: T.number,
    yMin: T.number,
    xMax: T.number,
    yMax: T.number,
  }

  getDefaultProps(): PdfRegionShape['props'] {
    return { w: 320, h: 180, pdfId: '', pageNumber: 1, rotation: 0, xMin: 0, yMin: 0, xMax: 320, yMax: 180 }
  }

  override isAspectRatioLocked() {
    return true
  }

  override onResize(shape: PdfRegionShape, info: TLResizeInfo<PdfRegionShape>) {
    const { w, h } = shape.props
    const shortest = Math.min(w, h)
    return resizeBox(shape, info, { minWidth: w / shortest, minHeight: h / shortest })
  }

  component(shape: PdfRegionShape) {
    const editor = this.editor
    const { w, h } = shape.props
    const edge = useValue('PDF region resolution', () => {
      if (editor.getCulledShapes().has(shape.id)) return 0
      const pixels = Math.max(w, h) * editor.getZoomLevel() * (window.devicePixelRatio || 1)
      return Math.min(1536, Math.max(256, 2 ** Math.ceil(Math.log2(pixels))))
    }, [editor, shape.id, w, h])

    return (
      <HTMLContainer className="pdf-region-content">
        {edge > 0 && <RegionCanvas region={shape.props} edge={edge} />}
      </HTMLContainer>
    )
  }

  getIndicatorPath(shape: PdfRegionShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}

export function insertPdfRegion(editor: Editor, region: PdfRegion) {
  const { width, height } = regionSize(region)
  if (!(width > 0 && height > 0)) return

  const view = editor.getViewportPageBounds()
  const scale = Math.min(2, view.width * 0.7 / width, view.height * 0.65 / height)
  const w = width * scale
  const h = height * scale
  const id = createShapeId()

  editor.setCurrentTool('select')
  editor.markHistoryStoppingPoint('insert PDF region')
  editor.createShape({
    id,
    type: PDF_REGION,
    parentId: editor.getCurrentPageId(),
    x: view.center.x - w / 2,
    y: view.center.y - h / 2,
    props: { ...region, w, h },
  })
  editor.select(id)
}
