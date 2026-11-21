import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import type { Card } from './cardStorage'

export default function CardEditor({ card }: { card: Card }) {
  return (
    <main style={{ position: 'relative' }}>
      <Tldraw key={card.id} persistenceKey={card.persistenceKey} />
    </main>
  )
}
