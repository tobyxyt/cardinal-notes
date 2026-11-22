import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { getSnapshot, type Editor } from 'tldraw'
import type { LiveCanvas } from './canvasPersistence'
import type { PdfRegion, PdfRegionReference } from '../pdf/pdfRegion'
import { flushSync } from 'react-dom'
import CardEditor from './CardEditor'
import CardList from './CardList'
import { insertPdfRegion } from './PdfRegionShape'
import { useCardPdfReferences } from './useCardPdfReferences'
import { CARD_LIST_KEY, finishDeletion, loadCards, makeCard, saveCards, type Card, type CardListState } from './cardStorage'

export type CardWorkspaceActions = {
  placePdfRegion: (region: PdfRegion, cardId?: string) => void
  openCard: (cardId: string) => void
  captureCanvas: () => LiveCanvas | null
}

type CardWorkspaceProps = {
  ref: Ref<CardWorkspaceActions>
  onStartPdfRegion: (cardId: string) => void
  onActiveCardChange: (cardId: string) => void
  onOpenPdfSource: (region: PdfRegion) => void
  onReferencesChange: (references: PdfRegionReference[]) => void
}

export default function CardWorkspace({
  ref, onStartPdfRegion, onActiveCardChange, onOpenPdfSource, onReferencesChange,
}: CardWorkspaceProps) {
  const [cards, setCards] = useState(loadCards)
  const activeCard = cards.items.find((card) => card.id === cards.activeId)!
  const mounted = useRef<{ cardId: string; editor: Editor } | null>(null)
  const pendingRegions = useRef(new Map<string, PdfRegion[]>())
  const { watchReferences, hasUnknownReferences } = useCardPdfReferences(cards.items, onReferencesChange)

  useEffect(() => onActiveCardChange(activeCard.id), [activeCard.id, onActiveCardChange])

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
    openCard: selectCard,
    captureCanvas() {
      const current = mounted.current
      if (current?.cardId !== activeCard.id) return null
      current.editor.complete()
      return { persistenceKey: activeCard.persistenceKey, document: getSnapshot(current.editor.store).document }
    },
    placePdfRegion(region, cardId) {
      if (!cardId) {
        createCard(region)
        return
      }
      if (cards.activeId !== cardId) return

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

  function createCard(region?: PdfRegion) {
    updateCards((latest) => {
      const card = makeCard(latest.items)
      if (region) pendingRegions.current.set(card.id, [region])
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
      pendingRegions.current.delete(card.id)
      flushSync(() => setCards(next))
      return true
    })
    if (queued) await finishDeletion(card.persistenceKey)
  }

  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
      <CardList
        hasUnknownReferences={hasUnknownReferences}
        items={cards.items}
        activeId={cards.activeId}
        onCreate={() => createCard()}
        onStartPdfRegion={() => onStartPdfRegion(activeCard.id)}
        onSelect={selectCard}
        onRename={renameCard}
        onRemove={(card) => void removeCard(card)}
      />
      <CardEditor
        key={activeCard.persistenceKey}
        card={activeCard}
        onEditorMount={onEditorMount}
        onOpenPdfSource={onOpenPdfSource}
      />
    </div>
  )
}
