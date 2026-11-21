import { useEffect, useRef, useState } from 'react'
import type { Editor, TLRecord } from 'tldraw'
import type { PdfRegion, PdfRegionReference } from '../pdf/pdfRegion'
import type { Card } from './cardStorage'
import { canvasDatabaseName } from './deleteCanvas'

function regionsIn(records: TLRecord[]): PdfRegion[] {
  return records.flatMap((record) => {
    if (record.typeName !== 'shape' || record.type !== 'pdf-region') return []
    const { pdfId, pageNumber, rotation, xMin, yMin, xMax, yMax } = record.props
    return [{ pdfId, pageNumber, rotation, xMin, yMin, xMax, yMax }]
  })
}

function readRegions(persistenceKey: string) {
  return new Promise<PdfRegion[]>((resolve, reject) => {
    const request = indexedDB.open(canvasDatabaseName(persistenceKey))
    let missing = false
    request.onupgradeneeded = () => {
      // Abort creation when this Card has never had a mounted canvas.
      missing = true
      request.transaction?.abort()
    }
    request.onerror = () => {
      if (missing) resolve([])
      else reject(request.error)
    }
    request.onsuccess = () => {
      const db = request.result
      // This is the records store used by the pinned tldraw LocalIndexedDb implementation.
      if (!db.objectStoreNames.contains('records')) {
        db.close()
        resolve([])
        return
      }
      const transaction = db.transaction('records', 'readonly')
      const records = transaction.objectStore('records').getAll()
      transaction.oncomplete = () => {
        db.close()
        resolve(regionsIn(records.result))
      }
      transaction.onabort = () => {
        db.close()
        reject(transaction.error)
      }
    }
  })
}

export function useCardPdfReferences(items: Card[], report: (references: PdfRegionReference[]) => void) {
  const [byCard, setByCard] = useState(() => new Map<string, PdfRegion[]>())
  const pending = useRef(new Set<string>())
  const active = useRef<string | null>(null)
  const channel = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    const connection = new BroadcastChannel('cardinal-notes:pdf-region-changes')
    channel.current = connection
    connection.onmessage = ({ data }: MessageEvent<{ cardId: string; regions: PdfRegion[] }>) => {
      const { cardId, regions } = data
      if (active.current !== cardId) setByCard((current) => new Map(current).set(cardId, regions))
    }
    return () => {
      channel.current = null
      connection.close()
    }
  }, [])

  useEffect(() => {
    const missing = items.filter(({ id }) => !byCard.has(id) && !pending.current.has(id))
    for (const { id } of missing) pending.current.add(id)

    async function readMissing() {
      // Read one canvas at a time, since a full document may have many other shapes.
      for (const { id, persistenceKey } of missing) {
        try {
          const regions = await readRegions(persistenceKey)
          // A live editor or a peer tab may have reported newer records during the read.
          setByCard((current) => current.has(id) ? current : new Map(current).set(id, regions))
        } catch (error) {
          console.error('Could not read Card references', error)
        } finally {
          pending.current.delete(id)
        }
      }
    }
    void readMissing()
  }, [items, byCard])

  useEffect(() => {
    report(items.flatMap(({ id, title }) =>
      (byCard.get(id) ?? []).map((region) => ({ cardId: id, cardTitle: title, region })),
    ))
  }, [items, byCard, report])

  function watchEditor(cardId: string, editor: Editor) {
    active.current = cardId
    let previous = ''
    function publish() {
      const regions = regionsIn(editor.store.allRecords())
      const signature = JSON.stringify(regions)
      if (signature === previous) return
      previous = signature
      setByCard((current) => new Map(current).set(cardId, regions))
      channel.current?.postMessage({ cardId, regions })
    }

    publish()
    const unlisten = editor.store.listen(({ changes }) => {
      const changed = [...Object.values(changes.added), ...Object.values(changes.removed)]
      if (changed.some((record) => record.typeName === 'shape' && record.type === 'pdf-region') ||
          Object.values(changes.updated).some(([before, after]) =>
            before.typeName === 'shape' && before.type === 'pdf-region' &&
            after.typeName === 'shape' && before.props !== after.props,
          )) publish()
    }, { scope: 'document' })
    return () => {
      unlisten()
      if (active.current === cardId) active.current = null
    }
  }

  return watchEditor
}
