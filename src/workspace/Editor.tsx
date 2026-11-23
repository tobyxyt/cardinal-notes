import { lazy, Suspense, useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import CardWorkspace, { type CardWorkspaceActions } from '../cards/CardWorkspace'
import { loadCards, type Card } from '../cards/cardStorage'
import Library, { type LibraryDocument } from '../library/Library'
import type { PdfRegion, PdfRegionReference } from '../pdf/pdfRegion'
import WorkspaceLayout from '../WorkspaceLayout'
import WorkspaceNavigation from '../WorkspaceNavigation'
import { usePdfWorkspace } from '../pdf/usePdfWorkspace'
import { listPdfs } from '../pdf/pdfStorage'
import type { useWorkspaceSessions } from './useWorkspaceSessions'
import type { Page } from './useWorkspaceNavigation'
import { saveView, showPane, updateTab, pruneDocuments, type DocumentKind } from './workspaceStorage'

const PdfWorkspace = lazy(() => import('../pdf/PdfWorkspace'))
type RegionTarget = { mode: 'create' } | { mode: 'insert'; cardId: string }

export default function Editor({
  cards, onPdfImportingChange, sessions, page, onOpenDocument, onDeleteDocument,
}: {
  cards: RefObject<CardWorkspaceActions | null>
  onPdfImportingChange: (pending: boolean) => void
  sessions: ReturnType<typeof useWorkspaceSessions>
  page: Page
  onOpenDocument: (document: LibraryDocument) => void
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
    page === 'editor' ? destination : null, cancelPdfJump, onPdfImportingChange)
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
    if (!target || page !== 'editor') return
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

  function selectPdfFiles() {
    pdfInput.current?.click()
  }

  function confirmRegion(region: PdfRegion) {
    if (!target) return
    revealPane('card')
    cards.current?.placePdfRegion(region, target.mode === 'insert' ? target.cardId : undefined)
    setTarget(null)
  }

  const showingEditor = page === 'editor'

  return (
    <>
      <div className="editor-page" inert={!showingEditor} data-obscured={!showingEditor ? '' : undefined}>
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
          overlay={showingEditor && (
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
          void pdf.importFiles(files, showingEditor)
        }} />
      {page === 'library' && (
        <Library files={pdf.files} cards={cardCatalog} references={references} hasUnknownReferences={hasUnknownReferences}
          loading={pdf.loading} importDisabled={pdf.loading || pdf.importing} onImport={selectPdfFiles}
          importStatus={pdf.importing ? '正在导入 PDF…' : pdf.notice} pdfErrors={pdf.errors}
          onOpenDocument={(document) => {
            setSelection(null)
            cancelPdfJump()
            onOpenDocument(document)
          }} onDeleteDocument={onDeleteDocument} />
      )}
    </>
  )
}
