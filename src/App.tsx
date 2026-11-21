import { lazy, Suspense, useCallback, useEffect, useRef, useState, type Dispatch, type PointerEvent, type ReactNode, type RefObject, type SetStateAction } from 'react'
import CardWorkspace, { type CardWorkspaceActions } from './cards/CardWorkspace'
import type { PdfRegion, PdfRegionReference } from './pdf/pdfRegion'
import BackupControls from './backup/BackupControls'
import { ACTIVE_DATASET_KEY, readActiveDataset, WORKSPACE_LOCK, workspaceDataset } from './dataset'
import './App.css'

const PdfWorkspace = lazy(() => import('./pdf/PdfWorkspace'))
const MIN_PDF_WIDTH = 20
const MAX_PDF_WIDTH = 80

function clampWidth(width: number) {
  return Math.min(MAX_PDF_WIDTH, Math.max(MIN_PDF_WIDTH, width))
}

type RegionTarget = { mode: 'create' } | { mode: 'insert'; cardId: string }

function Workspace({
  cards, onPdfImportingChange, pdfWidth, setPdfWidth,
}: {
  cards: RefObject<CardWorkspaceActions | null>
  onPdfImportingChange: (pending: boolean) => void
  pdfWidth: number
  setPdfWidth: Dispatch<SetStateAction<number>>
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

  function openPdfSource(region: PdfRegion) {
    setTarget(null)
    setDestination({ ...region })
  }

  const cancelPdfJump = useCallback(() => setDestination(null), [])

  function confirmRegion(region: PdfRegion) {
    if (!target) return
    cards.current?.placePdfRegion(region, target.mode === 'insert' ? target.cardId : undefined)
    setTarget(null)
  }

  const layout = useRef<HTMLDivElement>(null)
  const grabOffset = useRef(0)

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return

    const divider = event.currentTarget
    grabOffset.current = event.clientX - divider.getBoundingClientRect().left
    divider.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    const divider = event.currentTarget
    if (!divider.hasPointerCapture(event.pointerId)) return

    const bounds = layout.current!.getBoundingClientRect()
    const paneWidth = bounds.width - divider.offsetWidth
    if (paneWidth <= 0) return

    const width = event.clientX - bounds.left - grabOffset.current
    setPdfWidth(clampWidth((width / paneWidth) * 100))
  }

  return (
    <div
      className="split-workspace"
      ref={layout}
      style={{ gridTemplateColumns: `minmax(0, ${pdfWidth}fr) auto minmax(0, ${100 - pdfWidth}fr)` }}
    >
      <div className="workspace-pane" id="pdf-pane">
        <Suspense fallback={<p role="status">正在加载 PDF 阅读器…</p>}>
          <PdfWorkspace
            selectionMode={target?.mode ?? null}
            onStartSelection={() => setTarget({ mode: 'create' })}
            onCancelSelection={() => setTarget(null)}
            onConfirmRegion={confirmRegion}
            references={references}
            sourceRequest={destination}
            onCancelSourceRequest={cancelPdfJump}
            onOpenCard={(cardId) => cards.current?.openCard(cardId)}
            onImportingChange={onPdfImportingChange}
          />
        </Suspense>
      </div>
      <div
        className="workspace-divider"
        role="separator"
        tabIndex={0}
        aria-label="调整 PDF 和 Card 栏宽"
        aria-orientation="vertical"
        aria-controls="pdf-pane"
        aria-valuemin={MIN_PDF_WIDTH}
        aria-valuemax={MAX_PDF_WIDTH}
        aria-valuenow={Math.round(pdfWidth)}
        onPointerDown={startResize}
        onPointerMove={resize}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          event.stopPropagation()
          const delta = event.key === 'ArrowLeft' ? -5 : 5
          setPdfWidth((width) => clampWidth(width + delta))
        }}
      />
      <div className="workspace-pane">
        <CardWorkspace
          ref={cards}
          onStartPdfRegion={(cardId) => setTarget({ mode: 'insert', cardId })}
          onActiveCardChange={onActiveCardChange}
          onOpenPdfSource={openPdfSource}
          onReferencesChange={setReferences}
        />
      </div>
    </div>
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
  const [pdfWidth, setPdfWidth] = useState(50)

  useEffect(() => {
    function reloadDataset(event: StorageEvent) {
      if (event.key === ACTIVE_DATASET_KEY && readActiveDataset() !== workspaceDataset) window.location.reload()
    }
    window.addEventListener('storage', reloadDataset)
    return () => window.removeEventListener('storage', reloadDataset)
  }, [])

  return (
    <div className="app-shell">
      <BackupControls
        disabled={importingPdf}
        captureCanvas={() => cards.current?.captureCanvas() ?? null}
        setBusy={setBusy}
        setPaused={setPaused}
      />
      <div className="app-workspace" inert={busy}>
        {!paused && (
          <WorkspaceLease>
            <Workspace
              cards={cards}
              onPdfImportingChange={setImportingPdf}
              pdfWidth={pdfWidth}
              setPdfWidth={setPdfWidth}
            />
          </WorkspaceLease>
        )}
      </div>
    </div>
  )
}
