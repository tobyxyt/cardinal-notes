import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { savePdf } from './pdfStorage'

GlobalWorkerOptions.workerSrc = workerUrl

const assetUrl = new URL(`${import.meta.env.BASE_URL}pdf-assets/`, document.baseURI).href

export function openPdf(bytes: ArrayBuffer) {
  return getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: `${assetUrl}cmaps/`,
    standardFontDataUrl: `${assetUrl}standard_fonts/`,
    wasmUrl: `${assetUrl}wasm/`,
    iccUrl: `${assetUrl}iccs/`,
    disableAutoFetch: true,
  })
}

export async function importPdf(file: File) {
  let bytes: ArrayBuffer
  try {
    bytes = await file.arrayBuffer()
  } catch {
    throw new Error('无法读取本地文件。')
  }

  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
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
