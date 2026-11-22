import type { TLRecord } from 'tldraw'
import { datasetKey } from '../dataset'
import type { PdfRegion } from '../pdf/pdfRegion'
import { readCanvasShapes, waitForCanvasSaves } from './canvasPersistence'

// A cache entry exists only after reading committed records with no editor holding
// the shared lock. Each editor invalidates it before tldraw can start writing.
// Participating tabs must run this protocol; the cache doesn't cover external DB writers.
export const REFERENCE_INDEX_PREFIX = datasetKey('pdf-reference-index:v1:')
const indexKey = (key: string) => REFERENCE_INDEX_PREFIX + key
const writerLock = (key: string) => datasetKey('pdf-reference-writer:' + key)
export const REFERENCE_CHANGE = datasetKey('pdf-region-changes')

export function regionIn(record: TLRecord): PdfRegion | undefined {
  if (record.typeName !== 'shape' || record.type !== 'pdf-region') return
  const { pdfId, pageNumber, rotation, xMin, yMin, xMax, yMax } = record.props
  return { pdfId, pageNumber, rotation, xMin, yMin, xMax, yMax }
}

function validRegion(value: unknown): value is PdfRegion {
  if (!value || typeof value !== 'object') return false
  const { pdfId, pageNumber, rotation, xMin, yMin, xMax, yMax } = value as PdfRegion
  return typeof pdfId === 'string' && pdfId.length > 0 && Number.isInteger(pageNumber) &&
    pageNumber > 0 && [0, 90, 180, 270].includes(rotation) &&
    [xMin, yMin, xMax, yMax].every(Number.isFinite) && xMax > xMin && yMax > yMin
}

function readIndex(key: string): PdfRegion[] | undefined {
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(indexKey(key)) ?? 'null')
    if (Array.isArray(cached) && cached.every(validRegion)) return cached
  } catch {
    // Missing, unreadable and malformed entries all require a source read.
  }
}

export function forgetReferenceIndex(key: string) {
  localStorage.removeItem(indexKey(key))
}

export function readReferences(key: string, signal: AbortSignal) {
  return navigator.locks.request(writerLock(key), { ifAvailable: true }, async (lock) => {
    if (signal.aborted) return null
    const cached = lock && readIndex(key)
    if (cached) return { regions: cached, editing: false }

    const regions = (await readCanvasShapes(key)).flatMap((record) => regionIn(record) ?? [])
    if (signal.aborted) return null
    if (lock) {
      try {
        localStorage.setItem(indexKey(key), JSON.stringify(regions))
      } catch {
        // An unavailable or full cache must not affect the source or the result.
      }
    }
    return { regions, editing: !lock }
  })
}

export function allowReferenceWrites(key: string, ready: () => void, failed: () => void) {
  const abort = new AbortController()
  const channel = new BroadcastChannel(REFERENCE_CHANGE)
  let stop: (() => void) | undefined
  void navigator.locks.request(writerLock(key), { mode: 'shared', signal: abort.signal }, () => {
    if (abort.signal.aborted) return
    forgetReferenceIndex(key)
    channel.postMessage({ persistenceKey: key })
    return new Promise<void>((resolve) => {
      stop = () => {
        // Keep the index dirty until the unmounted editor's delayed writes have finished.
        void waitForCanvasSaves().then(() => {
          resolve()
          channel.postMessage({ persistenceKey: key })
          window.dispatchEvent(new CustomEvent(REFERENCE_CHANGE, { detail: key }))
          channel.close()
        }).catch((error) => {
          // Fail closed: other tabs may still read committed records without caching them.
          console.error('Could not confirm Card shutdown for PDF references', error)
          channel.close()
        })
      }
      ready()
    })
  }).catch((error) => {
    if (!abort.signal.aborted) {
      console.error('Could not open Card for PDF references', error)
      failed()
    }
  })
  return () => {
    abort.abort()
    if (stop) stop()
    else channel.close()
  }
}
