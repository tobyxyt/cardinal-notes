import { useEffect, useState } from 'react'
import type { PdfRegion } from './pdfRegion'
import { listPdfs, readActivePdfId, readPdf, saveActivePdfId, type PdfFile } from './pdfStorage'

const PDFS_IMPORTED = 'cardinal-notes:pdfs-imported'

export function usePdfWorkspace(
  sourceRequest: PdfRegion | null,
  onCancelSourceRequest: () => void,
  onImportingChange: (importing: boolean) => void,
) {
  const [files, setFiles] = useState<PdfFile[]>([])
  const [tabs, setTabs] = useState<{ ids: string[]; activeId: string } | null>(null)
  const activeId = tabs?.activeId ?? ''
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState('')
  const [errors, setErrors] = useState('')
  const [sourceError, setSourceError] = useState('')
  const [destination, setDestination] = useState<PdfRegion | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadLibrary() {
      try {
        const library = await listPdfs()
        if (cancelled) return
        const previous = readActivePdfId()
        setFiles(library)
        setTabs((current) => {
          if (current) return current
          const first = library.find(({ id }) => id === previous)?.id ?? library[0]?.id
          return { ids: first ? [first] : [], activeId: first ?? '' }
        })
      } catch (error) {
        if (!cancelled) {
          console.error('Could not load the PDF list', error)
          setErrors('无法读取本地 PDF 列表。')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadLibrary()
    window.addEventListener(PDFS_IMPORTED, loadLibrary)
    return () => {
      cancelled = true
      window.removeEventListener(PDFS_IMPORTED, loadLibrary)
    }
  }, [])

  useEffect(() => {
    if (!sourceRequest || loading) return
    const region = sourceRequest
    let cancelled = false
    setDestination(null)
    setSourceError('')

    async function openSource() {
      try {
        // Check for a deleted source even when PDF.js still has it in memory.
        await readPdf(region.pdfId)
        if (cancelled) return
        const { acquirePdfDocument } = await import('./pdfDocument')
        if (cancelled) return
        const source = acquirePdfDocument(region.pdfId)
        try {
          const pdf = await source.promise
          if (cancelled) return
          if (region.pageNumber < 1 || region.pageNumber > pdf.numPages) {
            setSourceError('源 PDF 中找不到该选区的页码。')
            return
          }
          activatePdf(region.pdfId)
          setDestination(region)
        } finally {
          source.release()
        }
      } catch {
        if (!cancelled) setSourceError('源 PDF 已移除或无法读取。')
      }
    }

    void openSource()
    return () => { cancelled = true }
  }, [loading, sourceRequest])

  function activatePdf(id: string) {
    setTabs((current) => {
      if (current?.activeId === id) return current
      const ids = current?.ids ?? []
      return { ids: ids.includes(id) ? ids : [...ids, id], activeId: id }
    })
    saveActivePdfId(id)
  }

  function clearSourceRequest() {
    onCancelSourceRequest()
    setDestination(null)
    setSourceError('')
  }

  function selectPdf(id: string) {
    clearSourceRequest()
    activatePdf(id)
  }

  function closePdf(id: string) {
    if (!tabs?.ids.includes(id)) return
    const ids = tabs.ids.filter((item) => item !== id)
    const next = id === activeId ? ids[Math.min(tabs.ids.indexOf(id), ids.length - 1)] ?? '' : activeId
    if (id === activeId) {
      clearSourceRequest()
      saveActivePdfId(next)
    }
    setTabs({ ids, activeId: next })
  }

  async function importFiles(selected: File[]) {
    if (!selected.length) return
    setImporting(true)
    onImportingChange(true)
    setNotice('')
    setErrors('')
    let lastImportedId = ''
    const failures: string[] = []
    let duplicates = 0

    // Process one file at a time to bound the memory used by hashing and validation.
    for (const candidate of selected) {
      try {
        const { importPdf } = await import('./pdfDocument')
        const { file, duplicate } = await importPdf(candidate)
        lastImportedId = file.id
        if (duplicate) duplicates += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : '无法导入 PDF。'
        failures.push(`${candidate.name}（${message}）`)
      }
    }

    if (lastImportedId) {
      selectPdf(lastImportedId)
      // An import can finish after switching views and returning to the library.
      window.dispatchEvent(new Event(PDFS_IMPORTED))
    }
    if (duplicates) setNotice(`${duplicates} 份内容相同的 PDF 已在列表中。`)
    if (failures.length) setErrors(failures.join(' '))
    setImporting(false)
    onImportingChange(false)
  }

  const filesById = new Map(files.map((file) => [file.id, file]))
  const openFiles = (tabs?.ids ?? []).flatMap((id) => filesById.get(id) ?? [])
  return {
    files, openFiles, activeId, loading, importing, notice, errors, sourceError, destination,
    selectPdf, closePdf, importFiles,
  }
}

export type PdfWorkspaceState = ReturnType<typeof usePdfWorkspace>
