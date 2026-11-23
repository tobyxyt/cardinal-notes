import { Capacitor } from '@capacitor/core'
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import {
  ArrangeMenuSubmenu, ClipboardMenuGroup, ConversionsMenuGroup, DefaultContextMenu, DefaultErrorFallback, EditMenuSubmenu,
  ReorderMenuSubmenu, SelectAllMenuItem, Tldraw, TldrawUiMenuGroup, TldrawUiMenuItem,
  useEditor, useValue, type Editor, type TLErrorFallbackProps, type TLComponents, type TLUiContextMenuProps, type TLUiOverrides,
} from 'tldraw'
import 'tldraw/tldraw.css'
import type { PdfRegion } from '../pdf/pdfRegion'
import type { Card } from './cardStorage'
import CardToolbar from './CardToolbar'
import { watchCardToolPresets, withCardToolDragPreset } from './cardToolPresets'
import './CardEditor.css'
import { allowReferenceWrites } from './pdfReferenceIndex'
import { PdfRegionShapeUtil } from './PdfRegionShape'

const licenseKey = import.meta.env.VITE_TLDRAW_LICENSE_KEY?.trim() || undefined
const diagnoseCard = Capacitor.getPlatform() === 'ios' || new URLSearchParams(location.search).get('cardDiagnostics') === '1'

const shapeUtils = [PdfRegionShapeUtil]
const OpenPdfSource = createContext<(region: PdfRegion) => void>(() => undefined)

function CardContextMenu(props: TLUiContextMenuProps) {
  const editor = useEditor()
  const openSource = useContext(OpenPdfSource)
  const shape = useValue('PDF source under context menu', () => {
    const hit = editor.getShapeAtPoint(editor.inputs.getCurrentPagePoint(), { hitInside: true, hitLocked: true })
    if (hit?.type === 'pdf-region') return hit
    const selected = editor.getOnlySelectedShape()
    return !hit && selected?.type === 'pdf-region' ? selected : undefined
  }, [editor])

  return (
    <DefaultContextMenu {...props}>
      {shape && (
        <TldrawUiMenuGroup id="pdf-source">
          <TldrawUiMenuItem
            id="open-pdf-source"
            label="跳转到 PDF 来源"
            icon="external-link"
            readonlyOk
            onSelect={() => openSource(shape.props)}
          />
        </TldrawUiMenuGroup>
      )}
      <TldrawUiMenuGroup id="modify">
        <EditMenuSubmenu />
        <ArrangeMenuSubmenu />
        <ReorderMenuSubmenu />
      </TldrawUiMenuGroup>
      <ClipboardMenuGroup />
      <ConversionsMenuGroup />
      <TldrawUiMenuGroup id="select-all">
        <SelectAllMenuItem />
      </TldrawUiMenuGroup>
    </DefaultContextMenu>
  )
}

function CardErrorFallback(props: TLErrorFallbackProps) {
  useEffect(() => { console.error('[CardEditor] tldraw error boundary', props.error) }, [props.error])
  return <DefaultErrorFallback {...props} />
}

const components: TLComponents = {
  ErrorFallback: CardErrorFallback,
  ContextMenu: CardContextMenu,
  PageMenu: null,
  QuickActions: null,
  StylePanel: null,
  Toolbar: CardToolbar,
}

const overrides: TLUiOverrides = {
  tools(editor, tools) {
    return Object.fromEntries(Object.entries(tools).map(([id, tool]) => [id, withCardToolDragPreset(editor, tool)]))
  },
  actions(editor, actions) {
    delete actions['change-page-prev']
    delete actions['change-page-next']
    delete actions['move-to-new-page']

    const adjustStyles = actions['adjust-shape-styles']
    actions['adjust-shape-styles'] = {
      ...adjustStyles,
      onSelect(source) {
        const shape = editor.getOnlySelectedShape()
        const firstControl = editor.getContainer().querySelector<HTMLElement>('.card-style-dock :is(button, input[type=range])')
        if (shape?.type === 'image' || shape?.type === 'video' || !firstControl) {
          return adjustStyles.onSelect(source)
        }
        firstControl.focus()
      },
    }
    return actions
  },
}

export default function CardEditor({
  card, onEditorMount, onOpenPdfSource,
}: {
  card: Card
  onEditorMount: (cardId: string, editor: Editor) => () => void
  onOpenPdfSource: (region: PdfRegion) => void
}) {
  const { persistenceKey } = card
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const host = useRef<HTMLElement>(null)
  const attempt = useId()

  useEffect(() => {
    if (!diagnoseCard) return
    console.info('[CardEditor] mounted', { attempt, origin: location.protocol + '//' + location.host, licenseConfigured: !!licenseKey })
    const controller = new AbortController()
    const { signal } = controller
    window.addEventListener('error', (event) => {
      console.error('[CardEditor] window error', event.error ?? event.message)
    }, { signal })
    window.addEventListener('unhandledrejection', (event) => {
      console.error('[CardEditor] unhandled rejection', event.reason)
    }, { signal })
    return () => {
      controller.abort()
      console.info('[CardEditor] unmounted', { attempt })
    }
  }, [attempt])

  useEffect(() => {
    const failed = () => setState('failed')
    try {
      return allowReferenceWrites(persistenceKey, () => {
        if (diagnoseCard) console.info('[CardEditor] opening tldraw local store', { attempt })
        setState('ready')
      }, failed)
    } catch (error) {
      console.error('[CardEditor] reference writer initialization failed', error)
      failed()
    }
  }, [attempt, persistenceKey])

  // One layout sample after the SDK's five-second validation window. Diagnostics only.
  useEffect(() => {
    if (!diagnoseCard || state !== 'ready') return
    const timer = window.setTimeout(() => {
      const element = host.current
      if (!element) return
      const { width, height } = element.getBoundingClientRect()
      console.info('[CardEditor] layout after initialization', {
        attempt, width, height, visibility: getComputedStyle(element).visibility,
        mode: element.closest<HTMLElement>('.split-workspace')?.dataset.mode,
        pageHidden: !!element.closest('.editor-page[data-obscured]'),
        canvas: !!element.querySelector('.tl-canvas'),
        toolbar: !!element.querySelector('.card-tool-dock'),
        // The pinned SDK renders this marker when its license gate takes over.
        licenseGate: !!element.querySelector('[data-testid="tl-license-expired"]'),
      })
    }, 6000)
    return () => window.clearTimeout(timer)
  }, [attempt, state])
  if (state === 'failed') return <p role="alert">本地画布无法打开，请刷新后重试。</p>
  if (state === 'loading') return <p role="status">正在打开画布…</p>

  return (
    <main className="card-editor" ref={host}>
      <OpenPdfSource.Provider value={onOpenPdfSource}>
        <Tldraw
          persistenceKey={card.persistenceKey}
          licenseKey={licenseKey}
          components={components}
          overrides={overrides}
          shapeUtils={shapeUtils}
          onMount={(editor) => {
            const started = performance.now()
            if (diagnoseCard) console.info('[CardEditor] tldraw mounted; local store loaded', { attempt })
            const stopPresets = watchCardToolPresets(editor)
            const unmount = onEditorMount(card.id, editor)
            return () => {
              if (diagnoseCard) console.info('[CardEditor] tldraw disposed', { attempt, elapsedMs: Math.round(performance.now() - started) })
              stopPresets()
              unmount()
            }
          }}
        />
      </OpenPdfSource.Provider>
    </main>
  )
}
