import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import CardWorkspace, { type CardWorkspaceActions } from './cards/CardWorkspace'
import { loadCards, type Card } from './cards/cardStorage'
import { flushSync } from 'react-dom'
import { verifySavedCanvas, waitForCanvasSaves } from './cards/canvasPersistence'
import Library, { type LibraryDocument } from './library/Library'
import type { PdfRegion, PdfRegionReference } from './pdf/pdfRegion'
import BackupControls from './backup/BackupControls'
import { ACTIVE_DATASET_KEY, readActiveDataset, WORKSPACE_LOCK, workspaceDataset } from './dataset'
import WorkspaceLayout, { viewModes } from './WorkspaceLayout'
import WorkspaceIcon from './WorkspaceIcon'
import WorkspaceNavigation from './WorkspaceNavigation'
import { usePdfWorkspace } from './pdf/usePdfWorkspace'
import { listPdfs } from './pdf/pdfStorage'
import WorkspaceMenu from './workspace/WorkspaceMenu'
import { useWorkspaceSessions } from './workspace/useWorkspaceSessions'
import {
  changeSession, clearTabs, GENERAL_WORKSPACE, newWorkspace, pruneDocuments, readWorkspaces,
  saveView, updateTab, type DocumentKind,
} from './workspace/workspaceStorage'
import './App.css'

const PdfWorkspace = lazy(() => import('./pdf/PdfWorkspace'))
type Page = 'general' | 'library'
type RegionTarget = { mode: 'create' } | { mode: 'insert'; cardId: string }

function Workspace({
  cards, onPdfImportingChange, sessions, page, onPageChange, onDeleteDocument,
}: {
  cards: RefObject<CardWorkspaceActions | null>
  onPdfImportingChange: (pending: boolean) => void
  sessions: ReturnType<typeof useWorkspaceSessions>
  page: Page
  onPageChange: (page: Page) => void
  onDeleteDocument: (document: LibraryDocument & { title: string }) => void
}) {
  const { active: session, update, commit } = sessions
  const { id: workspaceId, layout } = session
  const [selection, setSelection] = useState<{ workspaceId: string; target: RegionTarget } | null>(null)
  const target = selection?.workspaceId === workspaceId ? selection.target : null
  const [source, setSource] = useState<{ workspaceId: string; region: PdfRegion } | null>(null)
  const destination = source?.workspaceId === workspaceId ? source.region : null
  const [references, setReferences] = useState<PdfRegionReference[]>([])
  const [hasUnknownReferences, setHasUnknownReferences] = useState(true)
  const activeCardId = session.card.activeId
  const [cardCatalog, setCardCatalog] = useState<Card[]>([])
  const pdfInput = useRef<HTMLInputElement>(null)
  const cancelPdfJump = useCallback(() => setSource(null), [])
  const pdf = usePdfWorkspace(session.pdf, (id) => openInSession('pdf', id), (id) => closeInSession('pdf', id),
    destination, cancelPdfJump, onPdfImportingChange)
  const onCardsChange = useCallback((items: Card[]) => {
    setCardCatalog(items)
    void commit((data) => pruneDocuments(data, 'card', new Set(loadCards().items.map(({ id }) => id))))
  }, [commit])

  useEffect(() => {
    if (pdf.filesReady) {
      void commit(async (data) => pruneDocuments(data, 'pdf', new Set((await listPdfs()).map(({ id }) => id))))
    }
  }, [commit, pdf.files, pdf.filesReady])

  useEffect(() => {
    setSelection((current) => current && (current.workspaceId !== workspaceId ||
      (current.target.mode === 'insert' && current.target.cardId !== activeCardId)) ? null : current)
    setSource((current) => current?.workspaceId === workspaceId ? current : null)
  }, [workspaceId, activeCardId])

  function setTarget(next: RegionTarget | null) {
    setSelection(next ? { workspaceId, target: next } : null)
  }

  function openInSession(kind: DocumentKind, id: string) {
    void update(workspaceId, (current) => showPane(updateTab(current, kind, id, true), kind))
  }

  function closeInSession(kind: DocumentKind, id: string) {
    void update(workspaceId, (current) => updateTab(current, kind, id, false))
  }

  useEffect(() => {
    if (!target || page !== 'general') return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setSelection(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [target, page])

  function revealPane(pane: 'pdf' | 'card') {
    void update(workspaceId, (current) => showPane(current, pane))
  }

  function openPdfSource(region: PdfRegion) {
    revealPane('pdf')
    setTarget(null)
    setSource({ workspaceId, region: { ...region } })
  }

  function openPdf(id: string) {
    pdf.selectPdf(id)
  }

  function openCard(id: string) {
    openInSession('card', id)
  }

  function openDocument(document: LibraryDocument) {
    setSelection(null)
    cancelPdfJump()
    void commit((data) => ({
      ...changeSession(data, GENERAL_WORKSPACE, (current) =>
        showPane(updateTab(current, document.kind, document.id, true), document.kind)),
      activeId: GENERAL_WORKSPACE,
    }), true).then((saved) => { if (saved) onPageChange('general') })
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
          onChange={(layout) => { void update(workspaceId, (current) => ({ ...current, layout })) }}
          pdf={(
            <Suspense fallback={<p className="workspace-notice" role="status">正在加载 PDF 阅读器…</p>}>
              <PdfWorkspace
                pdf={pdf}
                workspaceId={workspaceId}
                reading={session.reading}
                onReadingChange={(id, view) => { void update(workspaceId, (current) => saveView(current, id, view)) }}
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
              tabs={session.card}
              onOpenCard={openCard}
              onCloseCard={(id) => closeInSession('card', id)}
              onOpenPdfSource={openPdfSource}
              onReferencesChange={setReferences}
              onReferenceStatusChange={setHasUnknownReferences}
              onCardsChange={onCardsChange}
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
          onOpenDocument={openDocument} onDeleteDocument={onDeleteDocument} />
      )}
    </>
  )
}

function showPane(session: ReturnType<typeof newWorkspace>, kind: DocumentKind) {
  if (session.layout.mode === 'split' || session.layout.mode === kind) return session
  return { ...session, layout: { ...session.layout, mode: 'split' as const } }
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
  const sessions = useWorkspaceSessions()
  const { active, commit, update } = sessions
  const [operationError, setOperationError] = useState('')
  const [page, setPage] = useState<Page>('general')

  function selectWorkspace(id: string) {
    void commit((data) => data.items.some((item) => item.id === id) ? { ...data, activeId: id } : data, true)
      .then((saved) => { if (saved) setPage('general') })
  }

  function createWorkspace(name: string) {
    const session = newWorkspace(crypto.randomUUID(), name)
    void commit((data) => ({ activeId: session.id, items: [...data.items, session] }), true)
      .then((saved) => { if (saved) setPage('general') })
  }

  function deleteWorkspace() {
    if (active.id === GENERAL_WORKSPACE ||
        !window.confirm('删除工作区「' + active.name + '」？只删除工作区配置，Library 文档会保留。')) return
    void commit((data) => ({ activeId: GENERAL_WORKSPACE, items: data.items.filter(({ id }) => id !== active.id) }), true)
  }

  function clearWorkspace() {
    if (window.confirm('清空当前工作区打开的标签？Library 文档会保留。')) void update(active.id, clearTabs)
  }

  async function deleteDocument(document: LibraryDocument & { title: string }) {
    if (!window.confirm('永久删除「' + document.title + '」？这将从 Library 和所有工作区移除此文档。')) return
    setOperationError('')
    if (document.kind === 'card') {
      try { await cards.current?.removeCard(document.id) } catch (cause) {
        setOperationError(cause instanceof Error ? cause.message : '无法删除 Card。')
      }
      return
    }
    setBusy(true)
    try {
      const live = cards.current?.captureCanvas()
      if (live === undefined) throw new Error('当前画布还未准备好，请稍后重试。')
      if (live) await verifySavedCanvas(live)
      const { removeUnlinkedPdf } = await import('./library/removeUnlinkedPdf')
      flushSync(() => setPaused(true))
      await waitForCanvasSaves()
      await navigator.locks.request(WORKSPACE_LOCK, { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error('请关闭 Cardinal Notes 的其他标签页后重试。')
        if (readActiveDataset() !== workspaceDataset) throw new Error('当前数据已切换，请刷新后重试。')
        await removeUnlinkedPdf(document.id)
      })
      await commit(() => readWorkspaces())
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : '无法删除 PDF。')
    } finally {
      setPaused(false)
      setBusy(false)
    }
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
              disabled={busy} title={active.name} onClick={() => setPage('general')}>{active.name}</button>
            <WorkspaceMenu active={active} items={sessions.items} disabled={busy || importingPdf}
              onSelect={selectWorkspace} onCreate={createWorkspace}
              onRename={(name) => { if (active.id !== GENERAL_WORKSPACE) void update(active.id, (session) => ({ ...session, name })) }}
              onDelete={deleteWorkspace} onClear={clearWorkspace} />
            <button type="button" className="text-button" aria-current={page === 'library' ? 'page' : undefined}
              disabled={busy} onClick={() => setPage('library')}>Library</button>
          </nav>
        </div>
        {page === 'general' && <div className="layout-switch app-layout-switch" role="group" aria-label="工作区模式">
          {viewModes.map(({ mode, icon, label }) => (
            <button type="button" className="layout-option" key={mode} aria-pressed={active.layout.mode === mode}
              aria-label={label} title={label} disabled={busy} onClick={() => { void update(active.id, (session) => ({ ...session, layout: { ...session.layout, mode } })) }}>
              <WorkspaceIcon name={icon} />
              <span>{label}</span>
            </button>
          ))}
        </div>}
        <BackupControls
          disabled={importingPdf}
          captureCanvas={() => cards.current?.captureCanvas()}
          setBusy={setBusy}
          setPaused={setPaused}
        />
      </header>
      {(operationError || sessions.error) && <div className="workspace-error" role="alert">
        <span>{operationError || sessions.error}</span>
        {operationError && <button type="button" className="tool-button" aria-label="关闭错误"
          onClick={() => setOperationError('')}><WorkspaceIcon name="close" /></button>}
      </div>}
      <div className="app-workspace" inert={busy}>
        {!paused && (
          <WorkspaceLease>
            <Workspace
              cards={cards}
              onPdfImportingChange={setImportingPdf}
              sessions={sessions}
              page={page}
              onPageChange={setPage}
              onDeleteDocument={(document) => void deleteDocument(document)}
            />
          </WorkspaceLease>
        )}
      </div>
    </div>
  )
}
