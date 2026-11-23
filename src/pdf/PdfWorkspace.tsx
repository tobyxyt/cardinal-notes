import { useEffect, useMemo, useState } from 'react'
import WorkspaceIcon from '../WorkspaceIcon'
import { acquirePdfDocument, importPdf } from './pdfDocument'
import PdfList from './PdfList'
import PdfReader from './PdfReader'
import type { PdfRegion, PdfRegionMode, PdfRegionReference } from './pdfRegion'
import { listPdfs, readActivePdfId, readPdf, saveActivePdfId, type PdfFile } from './pdfStorage'
import './pdf.css'

const PDFS_IMPORTED = 'cardinal-notes:pdfs-imported'

type PdfWorkspaceProps = {
  selectionMode: PdfRegionMode | null
  onStartSelection: () => void
  onCancelSelection: () => void
  onConfirmRegion: (region: PdfRegion) => void
  references: PdfRegionReference[]
  sourceRequest: PdfRegion | null
  onCancelSourceRequest: () => void
  onOpenCard: (cardId: string) => void
  onImportingChange: (importing: boolean) => void
}

export default function PdfWorkspace(props: PdfWorkspaceProps) {
  const [files, setFiles] = useState<PdfFile[]>([])
  const [activeId, setActiveId] = useState('')
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState('')
  const [errors, setErrors] = useState('')
  const [sourceError, setSourceError] = useState('')
  const [destination, setDestination] = useState<PdfRegion | null>(null)
  const { sourceRequest } = props
  const references = useMemo(() => props.references.filter(({ region }) => region.pdfId === activeId),
    [props.references, activeId])

  useEffect(() => {
    let cancelled = false
    async function loadLibrary() {
      try {
        const library = await listPdfs()
        if (cancelled) return
        const previous = readActivePdfId()
        setFiles(library)
        setActiveId(library.find(({ id }) => id === previous)?.id ?? library[0]?.id ?? '')
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
        const source = acquirePdfDocument(region.pdfId)
        try {
          const pdf = await source.promise
          if (cancelled) return
          if (region.pageNumber < 1 || region.pageNumber > pdf.numPages) {
            setSourceError('源 PDF 中找不到该选区的页码。')
            return
          }
          setActiveId(region.pdfId)
          saveActivePdfId(region.pdfId)
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

  function selectPdf(id: string) {
    props.onCancelSourceRequest()
    setDestination(null)
    setSourceError('')
    setActiveId(id)
    saveActivePdfId(id)
  }

  async function importFiles(selected: File[]) {
    if (!selected.length) return
    setImporting(true)
    props.onImportingChange(true)
    setNotice('')
    setErrors('')
    let lastImportedId = ''
    const failures: string[] = []
    let duplicates = 0

    // Process one file at a time to bound the memory used by hashing and validation.
    for (const candidate of selected) {
      try {
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
    props.onImportingChange(false)
  }

  return (
    <section className="pdf-workspace" aria-label="PDF 阅读">
      <PdfList
        files={files}
        activeId={activeId}
        importDisabled={loading || importing}
        onImport={(selected) => void importFiles(selected)}
        onSelect={selectPdf}
      />
      {importing ? <p role="status">正在导入 PDF…</p> : notice && <p role="status">{notice}</p>}
      {errors && <p role="alert">{errors}</p>}
      {sourceError && <p role="alert">{sourceError}</p>}
      {activeId
        ? <PdfReader key={activeId} id={activeId} {...props} references={references} destination={destination} />
        : !loading && !errors && (
          <div className="pdf-empty">
            <span className="pdf-empty-icon"><WorkspaceIcon name="pdf" /></span>
            <strong>暂无 PDF</strong>
          </div>
        )}
      {!activeId && props.selectionMode && (
        <div className="pdf-tools">
          <span role="status">请先导入要引用的 PDF</span>
          <button type="button" className="text-button" onClick={props.onCancelSelection}>取消选区</button>
        </div>
      )}
    </section>
  )
}
