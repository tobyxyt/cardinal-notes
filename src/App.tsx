import { useState } from 'react'
import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'

type CardList = {
  ids: string[]
  activeId: string
}

const CARD_LIST_KEY = 'cardinal-notes:cards'

function saveCards(cards: CardList) {
  localStorage.setItem(CARD_LIST_KEY, JSON.stringify(cards))
  return cards
}

function loadCards(): CardList {
  const saved = localStorage.getItem(CARD_LIST_KEY)
  if (saved) return JSON.parse(saved) as CardList

  const id = crypto.randomUUID()
  return saveCards({ ids: [id], activeId: id })
}

const initialCards = loadCards()

export default function App() {
  const [cards, setCards] = useState(initialCards)

  // The first card also opens drawings saved by the single-card version.
  const persistenceKey = cards.activeId === cards.ids[0]
    ? 'cardinal-notes'
    : `cardinal-notes:card:${cards.activeId}`

  function createCard() {
    const { ids } = loadCards()
    const id = crypto.randomUUID()
    setCards(saveCards({ ids: [...ids, id], activeId: id }))
  }

  function selectCard(id: string) {
    const { ids } = loadCards()
    setCards(saveCards({ ids, activeId: id }))
  }

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
      <header style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid #ddd' }}>
        <button type="button" onClick={createCard} style={{ flexShrink: 0 }}>新建 Card</button>
        <div role="group" aria-label="Card 列表" style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          {cards.ids.map((id, index) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === cards.activeId}
              style={{ flexShrink: 0, fontWeight: id === cards.activeId ? 'bold' : 'normal' }}
              onClick={() => selectCard(id)}
            >
              Card {index + 1}
            </button>
          ))}
        </div>
      </header>
      <main style={{ position: 'relative' }}>
        <Tldraw key={cards.activeId} persistenceKey={persistenceKey} />
      </main>
    </div>
  )
}
