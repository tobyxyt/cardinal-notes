import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { PdfRegionReference } from './pdf/pdfRegion'
import type { PdfFile } from './pdf/pdfStorage'
import WorkspaceIcon from './WorkspaceIcon'
import type { WorkspaceMode } from './WorkspaceLayout'
import './workspaceNavigation.css'

type Side = 'pdf' | 'cards'
type NavigationState = { side: Side; pinned: boolean } | null

function EdgeNavigation({
  side, title, icon, state, setState, children,
}: {
  side: Side
  title: string
  icon: 'library' | 'link'
  state: NavigationState
  setState: React.Dispatch<React.SetStateAction<NavigationState>>
  children: (afterSelect: () => void) => ReactNode
}) {
  const panelId = useId()
  const root = useRef<HTMLDivElement>(null)
  const handle = useRef<HTMLButtonElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const open = state?.side === side
  const pinned = open && state.pinned

  useEffect(() => () => window.clearTimeout(timer.current), [])

  function close(restoreFocus: boolean) {
    window.clearTimeout(timer.current)
    setState((current) => current?.side === side ? null : current)
    if (restoreFocus) handle.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (!open) return
    function onEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || document.querySelector('.workspace-menu:popover-open')) return
      event.preventDefault()
      event.stopPropagation()
      close(root.current?.contains(document.activeElement) ?? false)
    }
    window.addEventListener('keydown', onEscape, true)
    return () => window.removeEventListener('keydown', onEscape, true)
  }, [open, side])

  function scheduleClose() {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (root.current?.contains(document.activeElement) || root.current?.matches(':hover')) return
      setState((current) => current?.side === side && !current.pinned ? null : current)
    }, 220)
  }

  return (
    <div className="edge-navigation" data-side={side}
      ref={root}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return
        window.clearTimeout(timer.current)
        if (!open) {
          timer.current = window.setTimeout(() => {
            setState((current) => current?.pinned ? current : { side, pinned: false })
          }, 170)
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') scheduleClose()
      }}
      onFocus={() => window.clearTimeout(timer.current)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose()
      }}>
      <button type="button" className="edge-nav-handle" ref={handle} aria-label={title}
        title={pinned ? '收起 ' + title : title} aria-expanded={open} aria-controls={panelId}
        data-pinned={pinned ? '' : undefined}
        onClick={() => {
          window.clearTimeout(timer.current)
          setState((current) => current?.side === side && current.pinned ? null : { side, pinned: true })
        }}>
        <WorkspaceIcon name={icon} />
      </button>
      <section id={panelId} className="edge-nav-panel" aria-label={title} hidden={!open}>
        {open && (
          <>
            <header className="edge-nav-header">
              <h2>{title}</h2>
              <button type="button" className="tool-button" aria-label={`关闭 ${title}`}
                title="收起导航" onClick={() => close(true)}>
                <WorkspaceIcon name="close" />
              </button>
            </header>
            {children(() => {
              if (!pinned) close(root.current?.contains(document.activeElement) ?? false)
            })}
          </>
        )}
      </section>
    </div>
  )
}

function PdfNavigation({
  files, openFiles, activeId, loading, importDisabled, onImport, onSelect,
}: {
  files: PdfFile[]
  openFiles: PdfFile[]
  activeId: string
  loading: boolean
  importDisabled: boolean
  onImport: () => void
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const keyword = query.trim().toLocaleLowerCase()
  const matches = files.filter(({ name }) => name.toLocaleLowerCase().includes(keyword))
  const opened = new Set(openFiles.map(({ id }) => id))

  return (
    <>
      <div className="edge-nav-tools">
        <label className="edge-nav-search">
          <WorkspaceIcon name="search" />
          <input type="search" aria-label="搜索 PDF" placeholder="搜索 PDF"
            value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        </label>
        <button type="button" className="tool-button" aria-label="导入 PDF" title="导入 PDF"
          disabled={importDisabled} onClick={onImport}>
          <WorkspaceIcon name="import" />
        </button>
      </div>
      <div className="edge-nav-body">
        {matches.length ? (
          <ul className="edge-nav-list">
            {matches.map(({ id, name }) => (
              <li key={id}>
                <button type="button" className="edge-nav-row" title={name}
                  aria-current={id === activeId ? 'true' : undefined} onClick={() => onSelect(id)}>
                  <WorkspaceIcon name="pdf" />
                  <span className="edge-nav-label">{name}</span>
                  {opened.has(id) && <span className="edge-nav-state">{id === activeId ? '正在阅读' : '已打开'}</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="edge-nav-empty" role={loading ? 'status' : undefined}>
          {loading ? '正在加载 PDF…' : files.length ? '没有匹配的 PDF' : '暂无 PDF'}
        </p>}
      </div>
    </>
  )
}

function LinkedCardNavigation({
  files, activePdfId, activeCardId, references, hasUnknownReferences, onOpenCard,
}: {
  files: PdfFile[]
  activePdfId: string
  activeCardId: string
  references: PdfRegionReference[]
  hasUnknownReferences: boolean
  onOpenCard: (cardId: string) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const groupId = useId()
  const ordered = [...files].sort((a, b) => Number(b.id === activePdfId) - Number(a.id === activePdfId))
  const linked = new Map<string, Map<string, string>>()
  for (const { cardId, cardTitle, region } of references) {
    let cards = linked.get(region.pdfId)
    if (!cards) linked.set(region.pdfId, cards = new Map())
    cards.set(cardId, cardTitle)
  }

  return (
    <div className="edge-nav-body linked-card-groups">
      {!ordered.length && <p className="edge-nav-empty">打开 PDF 后可查看关联的 Card</p>}
      {ordered.length > 0 && hasUnknownReferences && (
        <p className="edge-nav-notice" role="status">部分 PDF 引用尚未确认。</p>
      )}
      {ordered.map(({ id, name }) => {
        const active = id === activePdfId
        const open = expanded[id] ?? active
        const cards = linked.get(id)
        const bodyId = groupId + id
        return (
          <div className="linked-card-group" key={id} data-active={active ? '' : undefined}>
            <h3>
              <button type="button" className="edge-nav-row linked-card-heading" aria-expanded={open}
                aria-controls={bodyId} title={name} onClick={() => setExpanded((value) => ({ ...value, [id]: !open }))}>
                <WorkspaceIcon name={open ? 'down' : 'right'} />
                <span className="edge-nav-label">{name}</span>
                {active && <span className="edge-nav-state">正在阅读</span>}
              </button>
            </h3>
            <div id={bodyId} hidden={!open}>
              {cards?.size ? (
                <ul className="edge-nav-list">
                  {[...cards].map(([cardId, title]) => (
                    <li key={cardId}>
                      <button type="button" className="edge-nav-row linked-card-row" title={title}
                        aria-current={cardId === activeCardId ? 'true' : undefined} onClick={() => onOpenCard(cardId)}>
                        <WorkspaceIcon name="card" />
                        <span className="edge-nav-label">{title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="edge-nav-empty">{hasUnknownReferences ? '等待确认关联…' : '暂无关联 Card'}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function WorkspaceNavigation({
  mode, pdf, activeCardId, references, hasUnknownReferences, onImport, onOpenPdf, onOpenCard,
}: {
  mode: WorkspaceMode
  pdf: Pick<import('./pdf/usePdfWorkspace').PdfWorkspaceState, 'files' | 'openFiles' | 'activeId' | 'loading' | 'importing'>
  activeCardId: string
  references: PdfRegionReference[]
  hasUnknownReferences: boolean
  onImport: () => void
  onOpenPdf: (id: string) => void
  onOpenCard: (id: string) => void
}) {
  const [state, setState] = useState<NavigationState>(null)
  useEffect(() => {
    if (mode === 'split') return
    const hiddenSide = mode === 'pdf' ? 'cards' : 'pdf'
    setState((current) => current?.side === hiddenSide ? null : current)
  }, [mode])

  return (
    <>
      {mode !== 'card' && (
        <EdgeNavigation side="pdf" title="PDF 导航" icon="library" state={state} setState={setState}>
          {(afterSelect) => (
            <PdfNavigation files={pdf.files} openFiles={pdf.openFiles} activeId={pdf.activeId}
              loading={pdf.loading} importDisabled={pdf.loading || pdf.importing} onImport={onImport}
              onSelect={(id) => { onOpenPdf(id); afterSelect() }} />
          )}
        </EdgeNavigation>
      )}
      {mode !== 'pdf' && (
        <EdgeNavigation side="cards" title="Linked Cards" icon="link" state={state} setState={setState}>
          {(afterSelect) => (
            <LinkedCardNavigation files={pdf.openFiles} activePdfId={pdf.activeId} activeCardId={activeCardId}
              references={references} hasUnknownReferences={hasUnknownReferences}
              onOpenCard={(id) => { onOpenCard(id); afterSelect() }} />
          )}
        </EdgeNavigation>
      )}
    </>
  )
}
