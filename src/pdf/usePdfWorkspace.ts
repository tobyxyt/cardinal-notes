import { useEffect, useState } from 'react'
import type { PdfRegion } from './pdfRegion'
import type { Tabs } from '../workspace/workspaceStorage'
import { listPdfs, readPdf, type PdfFile } from './pdfStorage'

export const PDFS_IMPORTED = 'cardinal-notes:pdfs-imported'

export function usePdfWorkspace(
  tabs: Tabs,
  onOpen: (id: string) => void,
  onClose: (id: string) => void,
  sourceRequest: PdfRegion | null,
  onCancelSourceRequest: () => void,
  onImportingChange: (importing: boolean) => void,
) {
  const [files, setFiles] = useState<PdfFile[]>([])
  const [filesReady, setFilesReady] = useState(false)
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
        setFiles(library)
        setFilesReady(true)
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
          onOpen(region.pdfId)
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

  function clearSourceRequest() {
    onCancelSourceRequest()
    setDestination(null)
    setSourceError('')
  }

  function selectPdf(id: string) {
    clearSourceRequest()
    onOpen(id)
  }

  function closePdf(id: string) {
    if (id === tabs.activeId) clearSourceRequest()
    onClose(id)
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
  const openFiles = tabs.ids.flatMap((id) => filesById.get(id) ?? [])
  const activeId = filesById.has(tabs.activeId) ? tabs.activeId : ''
  return {
    files, filesReady, openFiles, activeId, loading, importing, notice, errors, sourceError, destination: destination?.pdfId === activeId ? destination : null,
    selectPdf, closePdf, importFiles,
  }
}

export type PdfWorkspaceState = ReturnType<typeof usePdfWorkspace>
