import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { readPdf, savePdf } from './pdfStorage'

GlobalWorkerOptions.workerSrc = workerUrl

export const pdfAssetUrl = new URL(`${import.meta.env.BASE_URL}pdf-assets/`, document.baseURI).href

export function openPdf(bytes: ArrayBuffer) {
  return getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: `${pdfAssetUrl}cmaps/`,
    standardFontDataUrl: `${pdfAssetUrl}standard_fonts/`,
    wasmUrl: `${pdfAssetUrl}wasm/`,
    iccUrl: `${pdfAssetUrl}iccs/`,
    disableAutoFetch: true,
  })
}

type OpenPdf = Awaited<ReturnType<typeof openPdf>['promise']>
type CachedDocument = { promise: Promise<OpenPdf>; users: number }

const documents = new Map<string, CachedDocument>()
const MAX_IDLE_DOCUMENTS = 2

async function loadStoredPdf(id: string) {
  const blob = await readPdf(id)
  const task = openPdf(await blob.arrayBuffer())
  try {
    return await task.promise
  } catch (error) {
    await task.destroy().catch(() => undefined)
    throw error
  }
}

export function acquirePdfDocument(id: string) {
  let entry = documents.get(id)
  if (!entry) {
    entry = { promise: loadStoredPdf(id), users: 0 }
    const created = entry
    void entry.promise.catch(() => {
      if (documents.get(id) === created) documents.delete(id)
    })
  }
  const document = entry
  document.users += 1
  documents.delete(id)
  documents.set(id, document)

  return {
    promise: document.promise,
    release() {
      document.users -= 1
      const idle = [...documents].filter(([, entry]) => entry.users === 0)
      for (const [oldId, old] of idle.slice(0, -MAX_IDLE_DOCUMENTS)) {
        documents.delete(oldId)
        void old.promise.then((pdf) => pdf.loadingTask.destroy()).catch(() => undefined)
      }
    },
  }
}

export async function pdfHash(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export async function importPdf(file: File) {
  let bytes: ArrayBuffer
  try {
    bytes = await file.arrayBuffer()
  } catch {
    throw new Error('无法读取本地文件。')
  }

  const hash = await pdfHash(bytes)
  // PDF.js can transfer the byte buffer to its worker. Save a Blob copy first.
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const task = openPdf(bytes)
  try {
    const pdf = await task.promise
    await pdf.getPage(1)
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new Error('暂不支持需要密码的 PDF。')
    }
    throw new Error('无法读取 PDF，文件可能已损坏。')
  } finally {
    await task.destroy()
  }

  try {
    return await savePdf(file.name, hash, blob)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      throw new Error('浏览器存储空间不足，PDF 未导入。')
    }
    throw new Error('无法将 PDF 保存到浏览器。')
  }
}
