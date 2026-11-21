// tldraw 5.6.2 has no public per-document deletion API. The names below
// come from that version's LocalIndexedDb implementation.
// @ts-expect-error LocalIndexedDb is available at runtime but omitted from the public types.
import { LocalIndexedDb } from 'tldraw'

const DOCUMENT_PREFIX = 'TLDRAW_DOCUMENT_v2'
const LEGACY_ASSET_PREFIX = 'TLDRAW_ASSET_STORE_v1'
const DB_INDEX_KEY = 'TLDRAW_DB_NAME_INDEX_v2'

export function canvasDatabaseName(persistenceKey: string) {
  return DOCUMENT_PREFIX + persistenceKey
}

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export async function waitForCanvasSaves() {
  // A tldraw connection leaves this set only after its shutdown writes have completed.
  const deadline = Date.now() + 10_000
  while (LocalIndexedDb.connectedInstances.size) {
    if (Date.now() >= deadline) throw new Error('画布保存尚未完成，请稍后重试。')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

export async function deleteCanvas(persistenceKey: string) {
  // An unmounted editor can still be opening its DB. Wait for those opens
  // before deleting. IndexedDB waits for connections and transactions to close.
  const connections: Iterable<{ pending(): Promise<void> }> = LocalIndexedDb.connectedInstances
  await Promise.all(Array.from(connections, (db) => db.pending()))
  const documentName = canvasDatabaseName(persistenceKey)
  await Promise.all([
    deleteDatabase(documentName),
    deleteDatabase(LEGACY_ASSET_PREFIX + persistenceKey),
  ])

  const names: string[] = JSON.parse(localStorage.getItem(DB_INDEX_KEY) ?? '[]')
  localStorage.setItem(DB_INDEX_KEY, JSON.stringify(names.filter((name) => name !== documentName)))
}
