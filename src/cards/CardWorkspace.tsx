import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import CardEditor from './CardEditor'
import CardList from './CardList'
import { CARD_LIST_KEY, finishDeletion, loadCards, makeCard, saveCards, type Card, type CardListState } from './cardStorage'

export default function CardWorkspace() {
  const [cards, setCards] = useState(loadCards)
  const activeCard = cards.items.find((card) => card.id === cards.activeId)!

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== CARD_LIST_KEY || !event.newValue) return
      const { pendingDeletes } = JSON.parse(event.newValue) as CardListState
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

  function updateCards(update: (latest: CardListState) => CardListState) {
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
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
      <CardList
        items={cards.items}
        activeId={cards.activeId}
        onCreate={createCard}
        onSelect={selectCard}
        onRename={renameCard}
        onRemove={(card) => void removeCard(card)}
      />
      <CardEditor card={activeCard} />
    </div>
  )
}
