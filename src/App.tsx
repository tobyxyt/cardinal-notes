import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import CardWorkspace, { type CardWorkspaceActions } from './cards/CardWorkspace'
import type { PdfRegion, PdfRegionReference } from './pdf/pdfRegion'
import BackupControls from './backup/BackupControls'
import { ACTIVE_DATASET_KEY, readActiveDataset, WORKSPACE_LOCK, workspaceDataset } from './dataset'
import WorkspaceLayout, { loadLayout, saveLayout, viewModes, type Layout } from './WorkspaceLayout'
import WorkspaceIcon from './WorkspaceIcon'
import './App.css'

const PdfWorkspace = lazy(() => import('./pdf/PdfWorkspace'))
type RegionTarget = { mode: 'create' } | { mode: 'insert'; cardId: string }

function Workspace({
  cards, onPdfImportingChange, layout, onLayoutChange,
}: {
  cards: RefObject<CardWorkspaceActions | null>
  onPdfImportingChange: (pending: boolean) => void
  layout: Layout
  onLayoutChange: (layout: Layout) => void
}) {
  const [target, setTarget] = useState<RegionTarget | null>(null)
  const [destination, setDestination] = useState<PdfRegion | null>(null)
  const [references, setReferences] = useState<PdfRegionReference[]>([])
  const onActiveCardChange = useCallback((cardId: string) => {
    setTarget((current) => current?.mode === 'insert' && current.cardId !== cardId ? null : current)
  }, [])

  useEffect(() => {
    if (!target) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setTarget(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [target])

  function revealPane(pane: 'pdf' | 'card') {
    if (layout.mode !== 'split' && layout.mode !== pane) onLayoutChange({ ...layout, mode: 'split' })
  }

  function openPdfSource(region: PdfRegion) {
    revealPane('pdf')
    setTarget(null)
    setDestination({ ...region })
  }

  const cancelPdfJump = useCallback(() => setDestination(null), [])

  function confirmRegion(region: PdfRegion) {
    if (!target) return
    revealPane('card')
    cards.current?.placePdfRegion(region, target.mode === 'insert' ? target.cardId : undefined)
    setTarget(null)
  }

  return (
    <WorkspaceLayout
      layout={layout}
      onChange={onLayoutChange}
      pdf={(
        <Suspense fallback={<p className="workspace-notice" role="status">正在加载 PDF 阅读器…</p>}>
          <PdfWorkspace
            selectionMode={target?.mode ?? null}
            onStartSelection={() => setTarget({ mode: 'create' })}
            onCancelSelection={() => setTarget(null)}
            onConfirmRegion={confirmRegion}
            references={references}
            sourceRequest={destination}
            onCancelSourceRequest={cancelPdfJump}
            onOpenCard={(cardId) => {
              revealPane('card')
              cards.current?.openCard(cardId)
            }}
            onImportingChange={onPdfImportingChange}
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
        />
      )}
    />
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
        <div className="app-brand"><span className="brand-mark" aria-hidden="true">C</span><span>Cardinal Notes</span></div>
        <div className="layout-switch" role="group" aria-label="工作区模式">
          {viewModes.map(({ mode, icon, label }) => (
            <button type="button" className="layout-option" key={mode} aria-pressed={layout.mode === mode}
              aria-label={label} title={label} disabled={busy} onClick={() => changeLayout({ ...layout, mode })}>
              <WorkspaceIcon name={icon} />
              <span>{label}</span>
            </button>
          ))}
        </div>
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
            />
          </WorkspaceLease>
        )}
      </div>
    </div>
  )
}
