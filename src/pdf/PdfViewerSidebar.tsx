import { useEffect, useRef, useState } from 'react'
import { AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/types/src/display/api'
import WorkspaceIcon from '../WorkspaceIcon'
import type { PdfViewerSession } from './PdfReader'

type Outline = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>
const PAGES_PER_GROUP = 24

function Thumbnail({ pdf, page, rotation }: { pdf: PDFDocumentProxy; page: number; rotation: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const target = canvas.current!
    let disposed = false
    let task: RenderTask | undefined
    let started = false
    async function draw() {
      try {
        const pdfPage = await pdf.getPage(page)
        if (disposed) return
        const angle = (pdfPage.rotate + rotation) % 360
        const base = pdfPage.getViewport({ scale: 1, rotation: angle })
        const scale = Math.min(92 / base.width, 115 / base.height) * Math.min(window.devicePixelRatio, 2)
        const viewport = pdfPage.getViewport({ scale, rotation: angle })
        target.width = Math.ceil(viewport.width)
        target.height = Math.ceil(viewport.height)
        task = pdfPage.render({ canvas: target, viewport, annotationMode: AnnotationMode.DISABLE })
        await task.promise
        if (!disposed) target.style.visibility = 'visible'
      } catch {
        if (!disposed) setFailed(true)
      }
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || started) return
      started = true
      observer.disconnect()
      void draw()
    })
    observer.observe(target)
    return () => {
      disposed = true
      observer.disconnect()
      task?.cancel()
      target.width = target.height = 0
      target.style.visibility = 'hidden'
    }
  }, [pdf, page, rotation])

  return failed ? <span>预览不可用</span> : <canvas ref={canvas} className="pdf-thumbnail" aria-hidden="true" />
}

function OutlineItems({ items, links }: { items: Outline; links: PdfViewerSession['links'] }) {
  return (
    <ul>
      {items.map(({ title, items: children, dest }, index) => (
        <li key={index}>
          {dest ? <button type="button" className="text-button" onClick={() => {
            void links.goToDestination(dest).catch(() => undefined)
          }}>{title}</button> : <span>{title}</span>}
          {!!children.length && <OutlineItems items={children} links={links} />}
        </li>
      ))}
    </ul>
  )
}

export default function PdfViewerSidebar({ panel, page, rotation, session, onClose }: {
  panel: 'thumbnails' | 'outline'
  page: number
  rotation: number
  session: PdfViewerSession
  onClose: () => void
}) {
  const { document: pdf, links } = session
  const [group, setGroup] = useState(() => Math.floor((page - 1) / PAGES_PER_GROUP))
  const [outline, setOutline] = useState<Outline | null>(null)
  const [outlineError, setOutlineError] = useState(false)
  const first = group * PAGES_PER_GROUP + 1
  const last = Math.min(first + PAGES_PER_GROUP - 1, pdf.numPages)
  const title = panel === 'thumbnails' ? '页面缩略图' : 'PDF 大纲'

  useEffect(() => {
    if (panel !== 'outline') return
    let active = true
    void pdf.getOutline().then(
      (items) => { if (active) setOutline(items ?? []) },
      () => { if (active) setOutlineError(true) },
    )
    return () => { active = false }
  }, [panel, pdf])

  return (
    <aside className="pdf-viewer-sidebar" aria-label={title} onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }}>
      <div className="pdf-sidebar-title">
        <strong>{title}</strong>
        <button type="button" className="tool-button" aria-label="关闭侧栏" onClick={onClose}><WorkspaceIcon name="close" /></button>
      </div>
      {panel === 'outline' ? (
        outlineError ? <p role="alert">无法读取大纲。</p> :
          outline === null ? <p role="status">正在读取大纲…</p> :
            outline.length ? <OutlineItems items={outline} links={links} /> : <p>此 PDF 没有内置大纲。</p>
      ) : (
        <>
          {pdf.numPages > PAGES_PER_GROUP && (
            <div className="pdf-thumbnail-paging">
              <button type="button" className="tool-button" aria-label="上一组页面" disabled={group === 0}
                onClick={() => setGroup(group - 1)}><WorkspaceIcon name="left" /></button>
              <span>{first}–{last}</span>
              <button type="button" className="tool-button" aria-label="下一组页面" disabled={last === pdf.numPages}
                onClick={() => setGroup(group + 1)}><WorkspaceIcon name="right" /></button>
            </div>
          )}
          <div className="pdf-thumbnail-grid">
            {Array.from({ length: last - first + 1 }, (_, index) => first + index).map((number) => (
              <button key={number} type="button" className="text-button" aria-label={`跳至第 ${number} 页`}
                aria-current={number === page ? 'page' : undefined} onClick={() => links.goToPage(number)}>
                <Thumbnail key={rotation} pdf={pdf} page={number} rotation={rotation} />
                <span>{number}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  )
}
