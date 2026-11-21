import { isEqual, type TLRecord, type TLSessionStateSnapshot, type TLStoreSnapshot } from 'tldraw'
import { canvasDatabaseName } from '../cards/deleteCanvas'

// Storage layout of the pinned tldraw 5.6.2 LocalIndexedDb.
const STORES = ['records', 'schema', 'session_state', 'assets']
const DB_VERSION = 4

export type CanvasData = {
  records: TLRecord[]
  schema: TLStoreSnapshot['schema'] | null
  sessions: { id: string; snapshot: TLSessionStateSnapshot; updatedAt: number }[]
  assets: Map<string, Blob>
}

export type LiveCanvas = { persistenceKey: string; document: TLStoreSnapshot }

function openCanvas(persistenceKey: string, create: boolean) {
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
      if (db.version !== DB_VERSION || STORES.some((name) => !db.objectStoreNames.contains(name))) {
        db.close()
        reject(new Error('画布存储版本与本版备份不兼容。'))
      } else resolve(db)
    }
  })
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

export function matchesLiveCanvas(data: CanvasData | null, live: LiveCanvas) {
  const stored = Object.fromEntries((data?.records ?? []).map((record) => [record.id, record]))
  return isEqual(stored, live.document.store)
}

export async function verifySavedCanvas(live: LiveCanvas) {
  const deadline = Date.now() + 5000
  do {
    if (matchesLiveCanvas(await readCanvas(live.persistenceKey), live)) return
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

export function removeStagedDatabase(name: string) {
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })
}
