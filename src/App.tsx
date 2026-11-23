import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import CardWorkspace, { type CardWorkspaceActions } from './cards/CardWorkspace'
import type { Card } from './cards/cardStorage'
import Library, { type LibraryDocument } from './library/Library'
import type { PdfRegion, PdfRegionReference } from './pdf/pdfRegion'
import BackupControls from './backup/BackupControls'
import { ACTIVE_DATASET_KEY, readActiveDataset, WORKSPACE_LOCK, workspaceDataset } from './dataset'
import WorkspaceLayout, { loadLayout, saveLayout, viewModes, type Layout } from './WorkspaceLayout'
import WorkspaceIcon from './WorkspaceIcon'
import WorkspaceNavigation from './WorkspaceNavigation'
import { usePdfWorkspace } from './pdf/usePdfWorkspace'
import './App.css'

const PdfWorkspace = lazy(() => import('./pdf/PdfWorkspace'))
type Page = 'general' | 'library'
type RegionTarget = { mode: 'create' } | { mode: 'insert'; cardId: string }

function Workspace({
  cards, onPdfImportingChange, layout, onLayoutChange, page, onPageChange,
}: {
  cards: RefObject<CardWorkspaceActions | null>
  onPdfImportingChange: (pending: boolean) => void
  layout: Layout
  onLayoutChange: (layout: Layout) => void
  page: Page
  onPageChange: (page: Page) => void
}) {
  const [target, setTarget] = useState<RegionTarget | null>(null)
  const [destination, setDestination] = useState<PdfRegion | null>(null)
  const [references, setReferences] = useState<PdfRegionReference[]>([])
  const [hasUnknownReferences, setHasUnknownReferences] = useState(true)
  const [activeCardId, setActiveCardId] = useState('')
  const [cardCatalog, setCardCatalog] = useState<Card[]>([])
  const pdfInput = useRef<HTMLInputElement>(null)
  const cancelPdfJump = useCallback(() => setDestination(null), [])
  const pdf = usePdfWorkspace(destination, cancelPdfJump, onPdfImportingChange)
  const onActiveCardChange = useCallback((cardId: string) => {
    setActiveCardId(cardId)
    setTarget((current) => current?.mode === 'insert' && current.cardId !== cardId ? null : current)
  }, [])

  useEffect(() => {
    if (!target || page !== 'general') return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setTarget(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [target, page])

  function revealPane(pane: 'pdf' | 'card') {
    if (layout.mode !== 'split' && layout.mode !== pane) onLayoutChange({ ...layout, mode: 'split' })
  }

  function openPdfSource(region: PdfRegion) {
    revealPane('pdf')
    setTarget(null)
    setDestination({ ...region })
  }

  function openPdf(id: string) {
    revealPane('pdf')
    pdf.selectPdf(id)
  }

  function openCard(id: string) {
    revealPane('card')
    cards.current?.openCard(id)
  }

  function openDocument(document: LibraryDocument) {
    if (document.kind === 'pdf') openPdf(document.id)
    else openCard(document.id)
    onPageChange('general')
  }

  function selectPdfFiles() {
    pdfInput.current?.click()
  }

  function confirmRegion(region: PdfRegion) {
    if (!target) return
    revealPane('card')
    cards.current?.placePdfRegion(region, target.mode === 'insert' ? target.cardId : undefined)
    setTarget(null)
  }

  const showingLibrary = page === 'library'

  return (
    <>
      <div className="general-page" inert={showingLibrary} data-obscured={showingLibrary ? '' : undefined}>
        <WorkspaceLayout
          layout={layout}
          onChange={onLayoutChange}
          pdf={(
            <Suspense fallback={<p className="workspace-notice" role="status">正在加载 PDF 阅读器…</p>}>
              <PdfWorkspace
                pdf={pdf}
                onImport={selectPdfFiles}
                selectionMode={target?.mode ?? null}
                onStartSelection={() => setTarget({ mode: 'create' })}
                onCancelSelection={() => setTarget(null)}
                onConfirmRegion={confirmRegion}
                references={references}
                onOpenCard={openCard}
              />
            </Suspense>
          )}
          card={(
            <CardWorkspace
              ref={cards}
              onStartPdfRegion={(cardId) => {
                revealPane('pdf')
                setTarget({ mode: 'insert', cardId })
              }}
              onActiveCardChange={onActiveCardChange}
              onOpenPdfSource={openPdfSource}
              onReferencesChange={setReferences}
              onReferenceStatusChange={setHasUnknownReferences}
              onCardsChange={setCardCatalog}
            />
          )}
          overlay={!showingLibrary && (
            <WorkspaceNavigation pdf={pdf} activeCardId={activeCardId} references={references}
              hasUnknownReferences={hasUnknownReferences} onImport={selectPdfFiles} onOpenPdf={openPdf}
              onOpenCard={openCard} />
          )}
        />
      </div>
      <input ref={pdfInput} type="file" accept=".pdf,application/pdf" aria-label="选择 PDF 文件" multiple hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          if (!files.length) return
          if (!showingLibrary) revealPane('pdf')
          void pdf.importFiles(files)
        }} />
      {showingLibrary && (
        <Library files={pdf.files} cards={cardCatalog} references={references} hasUnknownReferences={hasUnknownReferences}
          loading={pdf.loading} importDisabled={pdf.loading || pdf.importing} onImport={selectPdfFiles}
          importStatus={pdf.importing ? '正在导入 PDF…' : pdf.notice} pdfErrors={pdf.errors}
          onOpenDocument={openDocument} />
      )}
    </>
  )
}

function WorkspaceLease({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    let release: (() => void) | undefined
    const controller = new AbortController()
    void navigator.locks.request(WORKSPACE_LOCK, { mode: 'shared', signal: controller.signal }, async () => {
      if (cancelled) return
      if (readActiveDataset() !== workspaceDataset) {
        window.location.reload()
        return
      }
      await new Promise<void>((resolve) => {
        release = resolve
        setReady(true)
      })
    }).catch((error) => {
      if (!cancelled) console.error('Could not open workspace', error)
    })
    return () => {
      cancelled = true
      controller.abort()
      release?.()
    }
  }, [])
  return ready ? children : <p role="status">正在打开本地工作区…</p>
}

export default function App() {
  const cards = useRef<CardWorkspaceActions>(null)
  const [busy, setBusy] = useState(false)
  const [paused, setPaused] = useState(false)
  const [importingPdf, setImportingPdf] = useState(false)
  const [layout, setLayout] = useState(loadLayout)
  const [page, setPage] = useState<Page>('general')

  function changeLayout(next: Layout) {
    setLayout(next)
    saveLayout(next)
  }

  useEffect(() => {
    function reloadDataset(event: StorageEvent) {
      if (event.key === ACTIVE_DATASET_KEY && readActiveDataset() !== workspaceDataset) window.location.reload()
    }
    window.addEventListener('storage', reloadDataset)
    return () => window.removeEventListener('storage', reloadDataset)
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-start">
          <div className="app-brand"><span className="brand-mark" aria-hidden="true">C</span><span>Cardinal Notes</span></div>
          <nav className="app-pages" aria-label="主导航">
            <button type="button" className="text-button" aria-current={page === 'general' ? 'page' : undefined}
              disabled={busy} onClick={() => setPage('general')}>General</button>
            <button type="button" className="text-button" aria-current={page === 'library' ? 'page' : undefined}
              disabled={busy} onClick={() => setPage('library')}>Library</button>
          </nav>
        </div>
        {page === 'general' && <div className="layout-switch app-layout-switch" role="group" aria-label="工作区模式">
          {viewModes.map(({ mode, icon, label }) => (
            <button type="button" className="layout-option" key={mode} aria-pressed={layout.mode === mode}
              aria-label={label} title={label} disabled={busy} onClick={() => changeLayout({ ...layout, mode })}>
              <WorkspaceIcon name={icon} />
              <span>{label}</span>
            </button>
          ))}
        </div>}
        <BackupControls
          disabled={importingPdf}
          captureCanvas={() => cards.current?.captureCanvas() ?? null}
          setBusy={setBusy}
          setPaused={setPaused}
        />
      </header>
      <div className="app-workspace" inert={busy}>
        {!paused && (
          <WorkspaceLease>
            <Workspace
              cards={cards}
              onPdfImportingChange={setImportingPdf}
              layout={layout}
              onLayoutChange={changeLayout}
              page={page}
              onPageChange={setPage}
            />
          </WorkspaceLease>
        )}
      </div>
    </div>
  )
}
