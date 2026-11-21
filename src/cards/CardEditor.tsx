import { Tldraw, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import type { Card } from './cardStorage'

import { PdfRegionShapeUtil } from './PdfRegionShape'

const shapeUtils = [PdfRegionShapeUtil]

export default function CardEditor({
  card, onEditorMount,
}: { card: Card; onEditorMount: (cardId: string, editor: Editor) => () => void }) {
  return (
    <main style={{ position: 'relative' }}>
      <Tldraw
        key={card.id}
        persistenceKey={card.persistenceKey}
        shapeUtils={shapeUtils}
        onMount={(editor) => onEditorMount(card.id, editor)}
      />
    </main>
  )
}
