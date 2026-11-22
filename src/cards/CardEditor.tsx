import { createContext, useContext, useEffect, useState } from 'react'
import {
  DefaultContextMenu, DefaultContextMenuContent, Tldraw, TldrawUiMenuGroup, TldrawUiMenuItem,
  useEditor, useValue, type Editor, type TLUiContextMenuProps,
} from 'tldraw'
import 'tldraw/tldraw.css'
import type { PdfRegion } from '../pdf/pdfRegion'
import type { Card } from './cardStorage'
import { allowReferenceWrites } from './pdfReferenceIndex'
import { PdfRegionShapeUtil } from './PdfRegionShape'

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
      <DefaultContextMenuContent />
    </DefaultContextMenu>
  )
}

const components = { ContextMenu: CardContextMenu }

export default function CardEditor({
  card, onEditorMount, onOpenPdfSource,
}: {
  card: Card
  onEditorMount: (cardId: string, editor: Editor) => () => void
  onOpenPdfSource: (region: PdfRegion) => void
}) {
  const { persistenceKey } = card
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => allowReferenceWrites(persistenceKey, () => setState('ready'), () => setState('failed')), [persistenceKey])
  if (state === 'failed') return <p role="alert">本地画布无法打开，请刷新后重试。</p>
  if (state === 'loading') return <p role="status">正在打开画布…</p>

  return (
    <main style={{ position: 'relative' }}>
      <OpenPdfSource.Provider value={onOpenPdfSource}>
        <Tldraw
          persistenceKey={card.persistenceKey}
          components={components}
          shapeUtils={shapeUtils}
          onMount={(editor) => onEditorMount(card.id, editor)}
        />
      </OpenPdfSource.Provider>
    </main>
  )
}
