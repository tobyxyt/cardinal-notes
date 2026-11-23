import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FindState } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import WorkspaceIcon from '../WorkspaceIcon'
import type { PdfViewerSession } from './PdfViewerReader'
import PdfViewerSidebar from './PdfViewerSidebar'

type Matches = { current: number; total: number }
const noMatches = { current: 0, total: 0 }
type Panel = 'thumbnails' | 'outline'

export default function PdfViewerTools({ session, selecting }: { session: PdfViewerSession; selecting: boolean }) {
  const { viewer, document: pdf, links } = session
  const { eventBus } = viewer
  const [page, setPage] = useState(viewer.currentPageNumber)
  const [rotation, setRotation] = useState(viewer.pagesRotation)
  const [pageInput, setPageInput] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Matches>(noMatches)
  const [findState, setFindState] = useState(FindState.FOUND)
  const searchToggle = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    const options = { signal: controller.signal }
    eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => setPage(pageNumber), options)
    eventBus.on('rotationchanging', ({ pagesRotation }: { pagesRotation: number }) => setRotation(pagesRotation), options)
    eventBus.on('updatefindmatchescount', ({ matchesCount }: { matchesCount: Matches }) => setMatches(matchesCount), options)
    eventBus.on('updatefindcontrolstate', ({ state, matchesCount }: { state: number; matchesCount: Matches }) => {
      setFindState(state)
      setMatches(matchesCount)
    }, options)
    return () => controller.abort()
  }, [eventBus])

  function goToPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = Number(pageInput ?? page)
    if (Number.isInteger(target) && target >= 1 && target <= pdf.numPages) links.goToPage(target)
    setPageInput(null)
  }

  function find(value: string, type = '', findPrevious = false) {
    eventBus.dispatch('find', {
      source: viewer, type, query: value, findPrevious, highlightAll: true,
      caseSensitive: false, entireWord: false, matchDiacritics: false,
    })
  }

  function closeFind() {
    setFindOpen(false)
    eventBus.dispatch('findbarclose', { source: viewer })
    searchToggle.current?.focus()
  }

  function togglePanel(next: Panel) {
    setPanel(panel === next ? null : next)
  }

  return (
    <>
      <div className="pdf-tools pdf-viewer-tools" aria-label="PDF 导航工具">
        <form className="pdf-page-input" onSubmit={goToPage}>
          <input type="text" inputMode="numeric" aria-label="页码" value={pageInput ?? page}
            onChange={(event) => setPageInput(event.currentTarget.value)}
            onBlur={() => setPageInput(null)} />
          <span aria-label={`共 ${pdf.numPages} 页`}>/ {pdf.numPages}</span>
        </form>
        <button type="button" className="text-button" title="适应页面" disabled={selecting}
          onClick={() => { viewer.currentScaleValue = 'page-fit' }}>适应页面</button>
        <button type="button" className="tool-button" aria-label="顺时针旋转" title="顺时针旋转" disabled={selecting}
          onClick={() => {
            const currentPage = viewer.currentPageNumber
            viewer.pagesRotation = (viewer.pagesRotation + 90) % 360
            links.goToPage(currentPage)
          }}>↻</button>
        <button type="button" className="tool-button" aria-label="查找 PDF 文字" title="查找 PDF 文字"
          ref={searchToggle} aria-expanded={findOpen} onClick={() => {
            if (findOpen) closeFind()
            else {
              setFindOpen(true)
              if (query) find(query, 'highlightallchange')
            }
          }}><WorkspaceIcon name="search" /></button>
        <button type="button" className="text-button" aria-expanded={panel === 'thumbnails'} onClick={() => togglePanel('thumbnails')}>缩略图</button>
        <button type="button" className="text-button" aria-expanded={panel === 'outline'} onClick={() => togglePanel('outline')}>大纲</button>
      </div>
      {findOpen && (
        <form className="pdf-tools pdf-find" onSubmit={(event) => {
          event.preventDefault()
          if (query.trim()) find(query, 'again')
        }} onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            closeFind()
          } else if (event.key === 'Enter' && event.shiftKey && query.trim()) {
            event.preventDefault()
            find(query, 'again', true)
          }
        }}>
          <input type="search" autoFocus aria-label="PDF 搜索内容" placeholder="查找文字" value={query}
            onChange={(event) => {
              const value = event.currentTarget.value
              setQuery(value)
              setMatches(noMatches)
              find(value)
            }} />
          <button type="button" className="tool-button" title="上一个匹配" aria-label="上一个匹配" disabled={!query.trim()}
            onClick={() => find(query, 'again', true)}><WorkspaceIcon name="left" /></button>
          <button type="submit" className="tool-button" title="下一个匹配" aria-label="下一个匹配" disabled={!query.trim()}>
            <WorkspaceIcon name="right" />
          </button>
          <span className="pdf-find-count" role="status">
            {!query.trim() ? '' : findState === FindState.PENDING ? '正在查找…' :
              matches.total ? `${matches.current} / ${matches.total}` : findState === FindState.NOT_FOUND ? '无匹配' : ''}
          </span>
          <button type="button" className="tool-button" aria-label="关闭搜索" title="关闭搜索" onClick={closeFind}><WorkspaceIcon name="close" /></button>
        </form>
      )}
      {panel && <PdfViewerSidebar key={panel} panel={panel} page={page} rotation={rotation}
        session={session} onClose={() => setPanel(null)} />}
    </>
  )
}
