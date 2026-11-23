import { useEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import WorkspaceIcon from './WorkspaceIcon'

export type WorkspaceMode = 'pdf' | 'split' | 'card'
export type Layout = { mode: WorkspaceMode; pdfWidth: number }

const LAYOUT_KEY = 'cardinal-notes:workspace-layout'
const SNAP = 15
const MIN_PANE_PIXELS = 244

export function loadLayout(): Layout {
  try {
    const value = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as Layout | null
    if (value && ['pdf', 'split', 'card'].includes(value.mode) &&
        Number.isFinite(value.pdfWidth) && value.pdfWidth >= SNAP && value.pdfWidth <= 100 - SNAP) return value
  } catch {
    // An unavailable preference does not prevent opening the workspace.
  }
  return { mode: 'split', pdfWidth: 50 }
}

export const viewModes = [
  { mode: 'pdf', icon: 'pdf', label: '仅 PDF' },
  { mode: 'split', icon: 'split', label: '双栏' },
  { mode: 'card', icon: 'card', label: '仅 Card' },
] as const

type Drag = {
  pointerId: number
  start: number
  offset: number
  raw: number
  moved: boolean
}

function splitRatio(percent: number, available: number) {
  const minimum = Math.min(44, Math.max(SNAP, MIN_PANE_PIXELS / Math.max(1, available) * 100))
  return Math.max(minimum, Math.min(100 - minimum, percent))
}

export default function WorkspaceLayout({
  layout, onChange, pdf, card, overlay,
}: {
  layout: Layout
  onChange: (layout: Layout) => void
  pdf: ReactNode
  card: ReactNode
  overlay: ReactNode
}) {
  const surface = useRef<HTMLDivElement>(null)
  const separator = useRef<HTMLDivElement>(null)
  const edge = useRef<HTMLButtonElement>(null)
  const drag = useRef<Drag | null>(null)
  const frame = useRef(0)
  const returnFocus = useRef(false)
  const { mode, pdfWidth } = layout

  function clearPreview() {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    surface.current?.style.removeProperty('--drag-ratio')
    if (surface.current) {
      delete surface.current.dataset.resizing
      delete surface.current.dataset.snap
    }
    drag.current = null
  }

  useEffect(() => {
    clearPreview()
    if (returnFocus.current) {
      returnFocus.current = false
      if (mode === 'split') separator.current?.focus()
      else edge.current?.focus()
    }
    return clearPreview
  }, [mode])

  function changeMode(next: WorkspaceMode) {
    returnFocus.current = true
    onChange({ mode: next, pdfWidth })
  }

  function reset() {
    clearPreview()
    onChange({ mode: 'split', pdfWidth: 50 })
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || drag.current) return
    const divider = event.currentTarget
    divider.focus({ preventScroll: true })
    divider.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      start: event.clientX,
      offset: event.clientX - divider.getBoundingClientRect().left,
      raw: pdfWidth,
      moved: false,
    }
    event.preventDefault()
  }

  function updatePosition(event: PointerEvent<HTMLDivElement>, current: Drag) {
    const bounds = surface.current!.getBoundingClientRect()
    const available = bounds.width - event.currentTarget.offsetWidth
    if (available <= 0) return
    current.moved ||= Math.abs(event.clientX - current.start) >= 3
    current.raw = (event.clientX - bounds.left - current.offset) / available * 100
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    updatePosition(event, current)
    if (!current.moved || frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const element = surface.current!
      element.dataset.resizing = ''
      element.dataset.snap = current.raw <= SNAP ? 'pdf' : current.raw >= 100 - SNAP ? 'card' : ''
      element.style.setProperty('--drag-ratio', String(current.raw / 100))
    })
  }

  function endResize(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    updatePosition(event, current)
    const available = surface.current!.clientWidth - event.currentTarget.offsetWidth
    clearPreview()
    if (!current.moved || available <= 0) return
    if (current.raw <= SNAP) changeMode('card')
    else if (current.raw >= 100 - SNAP) changeMode('pdf')
    else onChange({ mode: 'split', pdfWidth: splitRatio(current.raw, available) })
  }

  const style = { '--split-ratio': pdfWidth / 100 } as CSSProperties

  return (
    <div className="split-workspace" data-mode={mode} ref={surface} style={style}>
      <div className="workspace-pane pdf-pane" id="pdf-pane" inert={mode === 'card'}>{pdf}</div>
      <div className="workspace-pane card-pane" id="card-pane" inert={mode === 'pdf'}>{card}</div>
      <div
        className="workspace-divider"
        ref={separator}
        hidden={mode !== 'split'}
        role="separator"
        tabIndex={0}
        aria-label="调整 PDF 和 Card 栏宽"
        aria-orientation="vertical"
        aria-controls="pdf-pane card-pane"
        aria-valuemin={SNAP}
        aria-valuemax={100 - SNAP}
        aria-valuenow={Math.round(pdfWidth)}
        title="拖动调整宽度，双击恢复等宽"
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={endResize}
        onPointerCancel={clearPreview}
        onLostPointerCapture={clearPreview}
        onDoubleClick={reset}
        onKeyDown={(event) => {
          const { key } = event
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Escape'].includes(key)) return
          if (key === 'Escape' && !drag.current) return
          event.preventDefault()
          event.stopPropagation()
          if (key === 'Escape') clearPreview()
          else if (key === 'Home') changeMode('card')
          else if (key === 'End') changeMode('pdf')
          else if (key === 'Enter') reset()
          else {
            const available = surface.current!.clientWidth - event.currentTarget.offsetWidth
            const delta = key === 'ArrowLeft' ? -5 : 5
            onChange({ mode: 'split', pdfWidth: splitRatio(pdfWidth + delta, available) })
          }
        }}
      />
      {overlay}
      {mode !== 'split' && (
        <button
          type="button"
          className="workspace-edge"
          ref={edge}
          onClick={() => changeMode('split')}
          aria-label={mode === 'card' ? '展开 PDF，恢复双栏' : '展开 Card，恢复双栏'}
          title={mode === 'card' ? '展开 PDF，恢复双栏' : '展开 Card，恢复双栏'}
        >
          <WorkspaceIcon name={mode === 'card' ? 'right' : 'left'} />
        </button>
      )}
    </div>
  )
}
