import * as tldraw from 'tldraw'
import type { TLRecord, TLSessionStateSnapshot, TLStoreSnapshot } from 'tldraw'

// Compatibility boundary for tldraw 5.6.2's persistenceKey implementation.
// Recheck database layout, record keys and shutdown semantics before upgrading.
const DOCUMENT_PREFIX = 'TLDRAW_DOCUMENT_v2'
const LEGACY_ASSET_PREFIX = 'TLDRAW_ASSET_STORE_v1'
const DB_INDEX_KEY = 'TLDRAW_DB_NAME_INDEX_v2'
const STORES = ['records', 'schema', 'session_state', 'assets']
const DB_VERSION = 4

type CanvasConnection = { pending: () => Promise<void> }

function canvasConnections(): Set<CanvasConnection> {
  // The runtime export is internal and intentionally absent from the public types.
  const connections: unknown = Reflect.get(tldraw, 'LocalIndexedDb')?.connectedInstances
  if (!(connections instanceof Set) || [...connections].some((db) => typeof db?.pending !== 'function')) {
    throw new Error('当前 tldraw 版本无法确认画布保存状态。')
  }
  return connections
}

function canvasDatabaseName(persistenceKey: string) {
  return DOCUMENT_PREFIX + persistenceKey
}

export type CanvasData = {
  records: TLRecord[]
  schema: TLStoreSnapshot['schema'] | null
  sessions: { id: string; snapshot: TLSessionStateSnapshot; updatedAt: number }[]
  assets: Map<string, Blob>
}

export type LiveCanvas = { persistenceKey: string; document: TLStoreSnapshot }

function openCanvas(persistenceKey: string, create: boolean, shapesOnly = false) {
  return new Promise<IDBDatabase | null>((resolve, reject) => {
    const name = canvasDatabaseName(persistenceKey)
    const request = create ? indexedDB.open(name, DB_VERSION) : indexedDB.open(name)
    let missing = false
    request.onupgradeneeded = () => {
      if (!create) {
        missing = true
        request.transaction?.abort()
      } else {
        for (const name of STORES) request.result.createObjectStore(name)
      }
    }
    request.onerror = () => missing ? resolve(null) : reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const layoutMatches = shapesOnly
        ? db.version <= DB_VERSION && db.objectStoreNames.contains('records')
        : db.version === DB_VERSION && STORES.every((name) => db.objectStoreNames.contains(name))
      if (!layoutMatches) {
        db.close()
        reject(new Error('画布存储版本与当前应用不兼容。'))
      } else resolve(db)
    }
  })
}

async function readRecords(persistenceKey: string, shapesOnly = false): Promise<TLRecord[]> {
  const db = await openCanvas(persistenceKey, false, shapesOnly)
  if (!db) return []
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('records', 'readonly')
      const range = shapesOnly ? IDBKeyRange.bound('shape:', 'shape;', false, true) : undefined
      const request = transaction.objectStore('records').getAll(range)
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error ?? new Error('无法读取画布记录。'))
    })
  } finally {
    db.close()
  }
}

export function readCanvasShapes(persistenceKey: string) {
  return readRecords(persistenceKey, true)
}

export async function readCanvas(persistenceKey: string): Promise<CanvasData | null> {
  const db = await openCanvas(persistenceKey, false)
  if (!db) return null

  try {
    return await new Promise<CanvasData>((resolve, reject) => {
      const transaction = db.transaction(STORES, 'readonly')
      const records = transaction.objectStore('records').getAll()
      const schema = transaction.objectStore('schema').get('schema')
      const sessions = transaction.objectStore('session_state').getAll()
      const assets = transaction.objectStore('assets')
      const keys = assets.getAllKeys()
      const blobs = assets.getAll()
      transaction.oncomplete = () => resolve({
        records: records.result,
        schema: schema.result ?? null,
        sessions: sessions.result,
        assets: new Map(keys.result.map((key, index) => [String(key), blobs.result[index]])),
      })
      transaction.onabort = () => reject(transaction.error ?? new Error('无法读取画布。'))
    })
  } finally {
    db.close()
  }
}

export function matchesLiveCanvas(data: Pick<CanvasData, 'records'> | null, live: LiveCanvas) {
  const stored = Object.fromEntries((data?.records ?? []).map((record) => [record.id, record]))
  return tldraw.isEqual(stored, live.document.store)
}

export async function verifySavedCanvas(live: LiveCanvas) {
  const deadline = Date.now() + 5000
  do {
    if (matchesLiveCanvas({ records: await readRecords(live.persistenceKey) }, live)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  } while (Date.now() < deadline)
  throw new Error('当前画布的最新修改尚未写入磁盘，请稍后重试。')
}

export async function writeCanvas(persistenceKey: string, data: CanvasData) {
  const db = (await openCanvas(persistenceKey, true))!
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORES, 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('画布恢复写入已中断。'))
      const records = transaction.objectStore('records')
      for (const record of data.records) records.add(record, record.id)
      if (data.schema) transaction.objectStore('schema').add(data.schema, 'schema')
      const sessions = transaction.objectStore('session_state')
      for (const session of data.sessions) sessions.add(session, session.id)
      const assets = transaction.objectStore('assets')
      for (const [id, blob] of data.assets) assets.add(blob, id)
    })
  } finally {
    db.close()
  }
}

export function removeStagedCanvas(persistenceKey: string) {
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(canvasDatabaseName(persistenceKey))
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })
}

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export async function waitForCanvasSaves() {
  // Ignore connections opened by a subsequent editor after the caller's teardown.
  return waitForConnectionsToClose([...canvasConnections()])
}

async function waitForConnectionsToClose(closing: CanvasConnection[]) {
  // A tldraw connection leaves this set only after its shutdown writes have completed.
  const deadline = Date.now() + 10_000
  while (closing.some((db) => canvasConnections().has(db))) {
    if (Date.now() >= deadline) throw new Error('画布保存尚未完成，请稍后重试。')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

export async function deleteCanvas(persistenceKey: string) {
  // An unmounted editor can still be opening its DB. Wait for those opens
  // before deleting. IndexedDB waits for connections and transactions to close.
  const connections = canvasConnections()
  await Promise.all(Array.from(connections, (db) => db.pending()))
  const documentName = canvasDatabaseName(persistenceKey)
  await Promise.all([
    deleteDatabase(documentName),
    deleteDatabase(LEGACY_ASSET_PREFIX + persistenceKey),
  ])

  const names: string[] = JSON.parse(localStorage.getItem(DB_INDEX_KEY) ?? '[]')
  localStorage.setItem(DB_INDEX_KEY, JSON.stringify(names.filter((name) => name !== documentName)))
}
