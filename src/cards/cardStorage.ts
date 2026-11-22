import { datasetKey, workspaceDataset } from '../dataset'
import { deleteCanvas } from './canvasPersistence'
import { forgetReferenceIndex } from './pdfReferenceIndex'

export type Card = {
  id: string
  title: string
  persistenceKey: string
}

export type CardListState = {
  items: Card[]
  activeId: string
  pendingDeletes: string[]
}

type OldCardList = {
  ids: string[]
  activeId: string
}

export const CARD_LIST_KEY = datasetKey('cards')

export function makeCard(items: Card[]): Card {
  const id = crypto.randomUUID()
  let number = items.length + 1
  while (items.some((card) => card.title === `Card ${number}`)) number += 1
  return { id, title: `Card ${number}`, persistenceKey: datasetKey(`card:${id}`) }
}

export function saveCards(cards: CardListState) {
  localStorage.setItem(CARD_LIST_KEY, JSON.stringify(cards))
  return cards
}

export function loadCards(): CardListState {
  const saved = localStorage.getItem(CARD_LIST_KEY)
  if (saved) {
    const cards = JSON.parse(saved) as CardListState | OldCardList
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
  const first = makeCard([])
  const card = workspaceDataset ? first : { ...first, persistenceKey: 'cardinal-notes' }
  return saveCards({ items: [card], activeId: card.id, pendingDeletes: [] })
}

const deletingCanvases = new Set<string>()

export async function finishDeletion(persistenceKey: string) {
  if (deletingCanvases.has(persistenceKey)) return
  deletingCanvases.add(persistenceKey)
  try {
    await deleteCanvas(persistenceKey)
    forgetReferenceIndex(persistenceKey)
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
