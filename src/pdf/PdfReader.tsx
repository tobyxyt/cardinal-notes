import { useEffect, useRef, useState } from 'react'
import { AnnotationEditorType, AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { EventBus, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import 'pdfjs-dist/legacy/web/pdf_viewer.css'
import { openPdf } from './pdfDocument'
import { readPdf } from './pdfStorage'

export default function PdfReader({ id }: { id: string }) {
  const container = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PDFViewer | null>(null)
  const [scale, setScale] = useState<number | null>(null)
  const [error, setError] = useState('')

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

    let task: ReturnType<typeof openPdf> | undefined
    async function showDocument() {
      try {
        const blob = await readPdf(id)
        if (signal.aborted) return
        const bytes = await blob.arrayBuffer()
        if (signal.aborted) return
        task = openPdf(bytes)
        const pdf = await task.promise
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
      void task?.destroy().catch((error) => console.error('Could not release the PDF', error))
    }
  }, [id])

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
        {error ? <span role="alert">{error}</span> : scale === null && <span role="status">正在打开 PDF…</span>}
      </div>
      <div className="pdf-scroll-area">
        <div className="pdf-scroll" ref={container} role="region" aria-label="PDF 页面" tabIndex={0}>
          <div className="pdfViewer" />
        </div>
      </div>
    </div>
  )
}
