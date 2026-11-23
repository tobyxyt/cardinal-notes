import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { getSnapshot, type Editor } from 'tldraw'
import type { LiveCanvas } from './canvasPersistence'
import type { PdfRegion, PdfRegionReference } from '../pdf/pdfRegion'
import { flushSync } from 'react-dom'
import type { Tabs } from '../workspace/workspaceStorage'
import CardEditor from './CardEditor'
import CardList from './CardList'
import { insertPdfRegion } from './PdfRegionShape'
import { useCardPdfReferences } from './useCardPdfReferences'
import { CARD_LIST_KEY, finishDeletion, loadCards, makeCard, saveCards, type Card, type CardListState } from './cardStorage'

export type CardWorkspaceActions = {
  placePdfRegion: (region: PdfRegion, cardId?: string) => void
  removeCard: (cardId: string) => Promise<void>
  captureCanvas: () => LiveCanvas | null | undefined
}

type CardWorkspaceProps = {
  ref: Ref<CardWorkspaceActions>
  onStartPdfRegion: (cardId: string) => void
  tabs: Tabs
  onOpenCard: (cardId: string) => void
  onCloseCard: (cardId: string) => void
  onOpenPdfSource: (region: PdfRegion) => void
  onReferencesChange: (references: PdfRegionReference[]) => void
  onReferenceStatusChange: (hasUnknownReferences: boolean) => void
  onCardsChange: (cards: Card[]) => void
}

export default function CardWorkspace({
  ref, tabs, onOpenCard, onCloseCard, onStartPdfRegion, onOpenPdfSource, onReferencesChange, onReferenceStatusChange, onCardsChange,
}: CardWorkspaceProps) {
  const [cards, setCards] = useState(loadCards)
  const activeCard = cards.items.find((card) => card.id === tabs.activeId)
  const byId = new Map(cards.items.map((card) => [card.id, card]))
  const openCards = tabs.ids.flatMap((id) => byId.get(id) ?? [])
  const mounted = useRef<{ cardId: string; editor: Editor } | null>(null)
  const pendingRegions = useRef(new Map<string, PdfRegion[]>())
  const { watchReferences, hasUnknownReferences } = useCardPdfReferences(cards.items, onReferencesChange)

  useEffect(() => onCardsChange(cards.items), [cards.items, onCardsChange])
  useEffect(() => onReferenceStatusChange(hasUnknownReferences), [hasUnknownReferences, onReferenceStatusChange])

  function onEditorMount(cardId: string, editor: Editor) {
    const current = { cardId, editor }
    mounted.current = current
    const unwatch = watchReferences(cardId, editor.store)
    // tldraw ignores history within onMount itself. Insert after mounting so the action is undoable.
    queueMicrotask(() => {
      if (mounted.current !== current) return
      const regions = pendingRegions.current.get(cardId)
      if (!regions) return
      pendingRegions.current.delete(cardId)
      regions.forEach((region) => insertPdfRegion(editor, region))
    })
    return () => {
      unwatch()
      if (mounted.current === current) mounted.current = null
    }
  }

  useImperativeHandle(ref, () => ({
    removeCard,
    captureCanvas() {
      if (!activeCard) return tabs.activeId ? undefined : null
      const current = mounted.current
      if (current?.cardId !== activeCard.id) return undefined
      current.editor.complete()
      return { persistenceKey: activeCard.persistenceKey, document: getSnapshot(current.editor.store).document }
    },
    placePdfRegion(region, cardId) {
      if (!cardId) {
        createCard(region)
        return
      }
      if (tabs.activeId !== cardId) return

      const current = mounted.current
      if (current?.cardId === cardId) {
        insertPdfRegion(current.editor, region)
      } else {
        const pending = pendingRegions.current.get(cardId) ?? []
        pendingRegions.current.set(cardId, [...pending, region])
      }
    },
  }))

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== CARD_LIST_KEY || !event.newValue) return
      const { pendingDeletes } = JSON.parse(event.newValue) as CardListState
      const latest = loadCards()
      // Close an editor for a removed card before this tab also attempts cleanup.
      flushSync(() => setCards(latest))
      pendingDeletes?.forEach((key) => { void finishDeletion(key) })
    }

    window.addEventListener('storage', onStorage)
    loadCards().pendingDeletes.forEach((key) => { void finishDeletion(key) })
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function updateCards(update: (latest: CardListState) => CardListState) {
    return navigator.locks.request(CARD_LIST_KEY, () => {
      const next = saveCards(update(loadCards()))
      setCards(next)
      return next
    })
  }

  function createCard(region?: PdfRegion) {
    void updateCards((latest) => {
      const card = makeCard(latest.items)
      if (region) pendingRegions.current.set(card.id, [region])
      return { ...latest, items: [...latest.items, card], activeId: card.id }
    }).then((next) => onOpenCard(next.activeId))
  }

  function renameCard(id: string, value: string) {
    const title = value.trim()
    if (!title) return
    void updateCards((latest) => ({
      ...latest,
      items: latest.items.map((card) => card.id === id ? { ...card, title } : card),
    }))
  }

  async function removeCard(cardId: string) {
    const queued = await navigator.locks.request(CARD_LIST_KEY, () => {
      const latest = loadCards()
      const card = latest.items.find(({ id }) => id === cardId)
      if (!card) return null
      const items = latest.items.filter(({ id }) => id !== cardId)
      const activeId = latest.activeId === cardId ? items[0]?.id ?? '' : latest.activeId
      const next = saveCards({
        items,
        activeId,
        pendingDeletes: [...latest.pendingDeletes, card.persistenceKey],
      })

      // Commit the editor unmount before requesting IndexedDB deletion.
      pendingRegions.current.delete(card.id)
      flushSync(() => setCards(next))
      return card.persistenceKey
    })
    if (queued) await finishDeletion(queued)
  }

  return (
    <div className="card-workspace">
      <CardList
        hasUnknownReferences={hasUnknownReferences}
        items={openCards}
        available={cards.items}
        activeId={tabs.activeId}
        onCreate={() => createCard()}
        onStartPdfRegion={() => { if (activeCard) onStartPdfRegion(activeCard.id) }}
        onSelect={onOpenCard}
        onRename={renameCard}
        onClose={onCloseCard}
      />
      {activeCard ? (
        <CardEditor key={activeCard.persistenceKey} card={activeCard} onEditorMount={onEditorMount}
          onOpenPdfSource={onOpenPdfSource} />
      ) : <div className="pdf-empty"><strong>打开或新建 Card</strong></div>}
    </div>
  )
}
