import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { deleteCanvas } from './deleteCanvas'

type Card = {
  id: string
  title: string
  persistenceKey: string
}

type CardList = {
  items: Card[]
  activeId: string
  pendingDeletes: string[]
}

type OldCardList = {
  ids: string[]
  activeId: string
}

const CARD_LIST_KEY = 'cardinal-notes:cards'

function makeCard(items: Card[]): Card {
  const id = crypto.randomUUID()
  let number = items.length + 1
  while (items.some((card) => card.title === `Card ${number}`)) number += 1
  return { id, title: `Card ${number}`, persistenceKey: `cardinal-notes:card:${id}` }
}

function saveCards(cards: CardList) {
  localStorage.setItem(CARD_LIST_KEY, JSON.stringify(cards))
  return cards
}

function loadCards(): CardList {
  const saved = localStorage.getItem(CARD_LIST_KEY)
  if (saved) {
    const cards = JSON.parse(saved) as CardList | OldCardList
    if ('items' in cards) return cards

    return {
      items: cards.ids.map((id, index) => ({
        id,
        title: `Card ${index + 1}`,
        persistenceKey: index === 0 ? 'cardinal-notes' : `cardinal-notes:card:${id}`,
      })),
      activeId: cards.activeId,
      pendingDeletes: [],
    }
  }

  // New installs use the original key so single-card installs keep their canvas.
  const card = { ...makeCard([]), persistenceKey: 'cardinal-notes' }
  return saveCards({ items: [card], activeId: card.id, pendingDeletes: [] })
}

const initialCards = loadCards()
const deletingCanvases = new Set<string>()

async function finishDeletion(persistenceKey: string) {
  if (deletingCanvases.has(persistenceKey)) return
  deletingCanvases.add(persistenceKey)
  try {
    await deleteCanvas(persistenceKey)
    await navigator.locks.request(CARD_LIST_KEY, () => {
      const cards = loadCards()
      if (cards.pendingDeletes.includes(persistenceKey)) {
        saveCards({
          ...cards,
          pendingDeletes: cards.pendingDeletes.filter((key) => key !== persistenceKey),
        })
      }
    })
  } catch (error) {
    // Keep the cleanup queued so reopening the app retries it.
    console.error('Could not delete the Card canvas', error)
  } finally {
    deletingCanvases.delete(persistenceKey)
  }
}

export default function App() {
  const [cards, setCards] = useState(initialCards)
  const [editingId, setEditingId] = useState<string | null>(null)
  const activeCard = cards.items.find((card) => card.id === cards.activeId)!

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== CARD_LIST_KEY || !event.newValue) return
      const { pendingDeletes } = JSON.parse(event.newValue) as CardList
      const latest = loadCards()
      // Close an editor for a removed card before this tab also attempts cleanup.
      flushSync(() => setCards((previous) => ({
        ...latest,
        activeId: latest.items.some((card) => card.id === previous.activeId)
          ? previous.activeId
          : latest.activeId,
      })))
      pendingDeletes?.forEach((key) => { void finishDeletion(key) })
    }

    window.addEventListener('storage', onStorage)
    loadCards().pendingDeletes.forEach((key) => { void finishDeletion(key) })
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function updateCards(update: (latest: CardList) => CardList) {
    void navigator.locks.request(CARD_LIST_KEY, () => {
      const latest = loadCards()
      const activeId = latest.items.some((card) => card.id === cards.activeId)
        ? cards.activeId
        : latest.activeId
      setCards(saveCards(update({ ...latest, activeId })))
    })
  }

  function createCard() {
    updateCards((latest) => {
      const card = makeCard(latest.items)
      return { ...latest, items: [...latest.items, card], activeId: card.id }
    })
  }

  function selectCard(id: string) {
    if (id === cards.activeId) return
    updateCards((latest) => ({
      ...latest,
      activeId: latest.items.some((card) => card.id === id) ? id : latest.activeId,
    }))
  }

  function renameCard(id: string, value: string) {
    setEditingId(null)
    const title = value.trim()
    if (!title) return
    updateCards((latest) => ({
      ...latest,
      items: latest.items.map((card) => card.id === id ? { ...card, title } : card),
    }))
  }

  async function removeCard(card: Card) {
    if (!window.confirm(`删除「${card.title}」及其画布？`)) return

    const queued = await navigator.locks.request(CARD_LIST_KEY, () => {
      const latest = loadCards()
      const index = latest.items.findIndex(({ id }) => id === card.id)
      if (index === -1) return false

      const items = latest.items.filter(({ id }) => id !== card.id)
      if (items.length === 0) items.push(makeCard([]))
      const activeId = items.some(({ id }) => id === cards.activeId)
        ? cards.activeId
        : items[Math.min(index, items.length - 1)].id
      const next = saveCards({
        items,
        activeId,
        pendingDeletes: [...latest.pendingDeletes, card.persistenceKey],
      })

      // Commit the editor unmount before requesting IndexedDB deletion.
      flushSync(() => setCards(next))
      return true
    })
    if (queued) await finishDeletion(card.persistenceKey)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
      <header style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid #ddd' }}>
        <button type="button" onClick={createCard} style={{ flexShrink: 0 }}>新建 Card</button>
        <div role="group" aria-label="Card 列表" style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          {cards.items.map((card) => (
            <div key={card.id} style={{ display: 'flex', flexShrink: 0 }}>
              {editingId === card.id ? (
                <input
                  aria-label="Card 标题"
                  autoFocus
                  defaultValue={card.title}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={() => setEditingId(null)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return
                    if (event.key === 'Enter') renameCard(card.id, event.currentTarget.value)
                    if (event.key === 'Escape') setEditingId(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  aria-pressed={card.id === cards.activeId}
                  style={{ fontWeight: card.id === cards.activeId ? 'bold' : 'normal' }}
                  onClick={() => selectCard(card.id)}
                  onDoubleClick={() => setEditingId(card.id)}
                >
                  {card.title}
                </button>
              )}
              <button type="button" aria-label={`删除 ${card.title}`} onClick={() => void removeCard(card)}>
                ×
              </button>
            </div>
          ))}
        </div>
      </header>
      <main style={{ position: 'relative' }}>
        <Tldraw key={activeCard.id} persistenceKey={activeCard.persistenceKey} />
      </main>
    </div>
  )
}
