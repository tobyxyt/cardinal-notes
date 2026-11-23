import { datasetKey } from '../dataset'

export type PdfFile = {
  id: string
  name: string
  hash: string
}

const ACTIVE_PDF = datasetKey('active-pdf')

export function readActivePdfId() {
  return localStorage.getItem(ACTIVE_PDF)
}

export function pdfDatabaseName(dataset?: string) {
  return datasetKey('pdfs', dataset)
}

let connection: Promise<IDBDatabase> | undefined

function connectDatabase(name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      const metadata = request.result.createObjectStore('metadata', { keyPath: 'id' })
      metadata.createIndex('hash', 'hash', { unique: true })
      request.result.createObjectStore('files')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function openDatabase() {
  connection ??= connectDatabase(pdfDatabaseName()).then((db) => {
    db.onversionchange = () => {
      db.close()
      connection = undefined
    }
    db.onclose = () => { connection = undefined }
    return db
  }).catch((error) => {
    connection = undefined
    throw error
  })
  return connection
}

export function removeStagedPdfs(dataset: string) {
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(pdfDatabaseName(dataset))
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })
}

export async function writeRestoredPdfs(dataset: string, entries: { file: PdfFile; blob: Blob }[]) {
  const db = await connectDatabase(pdfDatabaseName(dataset))
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['metadata', 'files'], 'readwrite')
      const metadata = transaction.objectStore('metadata')
      const files = transaction.objectStore('files')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('PDF 恢复写入已中断。'))
      for (const { file, blob } of entries) {
        metadata.add(file)
        files.add(blob, file.id)
      }
    })
  } finally {
    db.close()
  }
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function listPdfs(): Promise<PdfFile[]> {
  const db = await openDatabase()
  const records = await requestResult<PdfFile[]>(db.transaction('metadata').objectStore('metadata').getAll())
  return records.sort((a, b) => a.name.localeCompare(b.name))
}

export async function readPdf(id: string): Promise<Blob> {
  const db = await openDatabase()
  const blob = await requestResult<Blob | undefined>(db.transaction('files').objectStore('files').get(id))
  if (!blob) throw new Error('PDF 文件不在本地存储中。')
  return blob
}

export async function deletePdf(id: string) {
  const db = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(['metadata', 'files'], 'readwrite')
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('无法删除 PDF。'))
    transaction.objectStore('metadata').delete(id)
    transaction.objectStore('files').delete(id)
  })
}

export async function savePdf(name: string, hash: string, blob: Blob) {
  const db = await openDatabase()
  return new Promise<{ file: PdfFile; duplicate: boolean }>((resolve, reject) => {
    // Read and write under one transaction so concurrent imports cannot store duplicates.
    const transaction = db.transaction(['metadata', 'files'], 'readwrite')
    const metadata = transaction.objectStore('metadata')
    const match = metadata.index('hash').get(hash)
    let file: PdfFile
    let duplicate = false

    match.onsuccess = () => {
      const existing = match.result as PdfFile | undefined
      if (existing) {
        file = existing
        duplicate = true
        return
      }

      file = { id: crypto.randomUUID(), name, hash }
      metadata.add(file)
      transaction.objectStore('files').add(blob, file.id)
    }
    transaction.oncomplete = () => resolve({ file, duplicate })
    transaction.onabort = () => reject(transaction.error ?? new Error('PDF 存储已中断。'))
  })
}
