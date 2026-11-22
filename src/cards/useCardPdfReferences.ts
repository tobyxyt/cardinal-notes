import { useEffect, useRef, useState } from 'react'
import type { TLStore } from 'tldraw'
import type { PdfRegion, PdfRegionReference } from '../pdf/pdfRegion'
import type { Card } from './cardStorage'
import { readReferences, REFERENCE_CHANGE, REFERENCE_INDEX_PREFIX, regionIn } from './pdfReferenceIndex'

export function useCardPdfReferences(items: Card[], report: (references: PdfRegionReference[]) => void) {
  const [byCard, setByCard] = useState(() => new Map<string, PdfRegion[]>())
  const active = useRef<string | null>(null)
  const channel = useRef<BroadcastChannel | null>(null)
  const enqueue = useRef<(key?: string) => void>(() => undefined)

  useEffect(() => {
    const controller = new AbortController()
    const connection = new BroadcastChannel(REFERENCE_CHANGE)
    channel.current = connection
    const pending = new Set<Card>()
    const editingOrFailed = new Set<Card>()
    let reading = false
    let timer: number | undefined

    async function refresh() {
      timer = undefined
      reading = true
      for (const card of pending) {
        pending.delete(card)
        if (controller.signal.aborted) break
        if (active.current === card.id) {
          editingOrFailed.delete(card)
          continue
        }
        try {
          const result = await readReferences(card.persistenceKey, controller.signal)
          if (controller.signal.aborted || !result || active.current === card.id) continue
          if (result.editing) editingOrFailed.add(card)
          else editingOrFailed.delete(card)
          setByCard((current) => {
            if (active.current === card.id ||
                JSON.stringify(current.get(card.id)) === JSON.stringify(result.regions)) return current
            return new Map(current).set(card.id, result.regions)
          })
        } catch (error) {
          if (controller.signal.aborted) break
          if (!editingOrFailed.has(card)) console.error('Could not read Card references', error)
          editingOrFailed.add(card)
          setByCard((current) => {
            if (active.current === card.id || !current.has(card.id)) return current
            const next = new Map(current)
            next.delete(card.id)
            return next
          })
        }
      }
      reading = false
      // A crashed tab cannot send a close notification. Retry only unresolved Cards
      // so their index is rebuilt when its writer lock goes away.
      if (editingOrFailed.size && !controller.signal.aborted) {
        timer = window.setTimeout(() => {
          for (const card of editingOrFailed) pending.add(card)
          void refresh()
        }, 1500)
      }
    }

    function schedule(key?: string) {
      for (const card of items) {
        if (key === undefined || card.persistenceKey === key) pending.add(card)
      }
      if (reading || !pending.size) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void refresh(), 0)
    }
    enqueue.current = schedule
    function onStorage(event: StorageEvent) {
      if (event.key?.startsWith(REFERENCE_INDEX_PREFIX)) schedule(event.key.slice(REFERENCE_INDEX_PREFIX.length))
    }
    function onRelease(event: Event) { schedule((event as CustomEvent<string>).detail) }
    connection.onmessage = ({ data }) => {
      if (typeof data?.persistenceKey === 'string') schedule(data.persistenceKey)
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(REFERENCE_CHANGE, onRelease)
    setByCard((current) => {
      const ids = new Set(items.map(({ id }) => id))
      return [...current.keys()].every((id) => ids.has(id)) ? current
        : new Map([...current].filter(([id]) => ids.has(id)))
    })
    schedule()
    return () => {
      controller.abort()
      window.clearTimeout(timer)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(REFERENCE_CHANGE, onRelease)
      channel.current = null
      connection.close()
    }
  }, [items])

  useEffect(() => {
    report(items.flatMap(({ id, title }) =>
      (byCard.get(id) ?? []).map((region) => ({ cardId: id, cardTitle: title, region })),
    ))
  }, [items, byCard, report])

  function watchReferences(cardId: string, store: TLStore) {
    active.current = cardId
    const key = items.find(({ id }) => id === cardId)?.persistenceKey
    const shapes = store.query.records('shape', () => ({ type: { eq: 'pdf-region' } })).get()
    const regions = new Map<string, PdfRegion>(shapes.flatMap((record) => {
      const region = regionIn(record)
      return region ? [[record.id, region] as const] : []
    }))
    let previous = ''
    function publish() {
      const next = [...regions.values()]
      const signature = JSON.stringify(next)
      if (signature === previous) return
      previous = signature
      setByCard((current) => new Map(current).set(cardId, next))
      if (key) channel.current?.postMessage({ persistenceKey: key })
    }
    publish()
    const unlisten = store.listen(({ changes }) => {
      let changed = false
      for (const id of Object.keys(changes.removed)) changed = regions.delete(id) || changed
      const upserts = [...Object.values(changes.added), ...Object.values(changes.updated).map(([, after]) => after)]
      for (const record of upserts) {
        const region = regionIn(record)
        if (region) {
          regions.set(record.id, region)
          changed = true
        } else changed = regions.delete(record.id) || changed
      }
      if (changed) publish()
    }, { scope: 'document', source: 'all' })
    return () => {
      unlisten()
      if (active.current === cardId) active.current = null
      if (key) enqueue.current(key)
    }
  }

  return { watchReferences, hasUnknownReferences: items.some(({ id }) => !byCard.has(id)) }
}
