import { useEffect, useState } from 'react'
import { importPdf } from './pdfDocument'
import PdfList from './PdfList'
import PdfReader from './PdfReader'
import { listPdfs, readActivePdfId, saveActivePdfId, type PdfFile } from './pdfStorage'
import './pdf.css'

const PDFS_IMPORTED = 'cardinal-notes:pdfs-imported'

export default function PdfWorkspace() {
  const [files, setFiles] = useState<PdfFile[]>([])
  const [activeId, setActiveId] = useState('')
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState('')
  const [errors, setErrors] = useState('')

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

  function selectPdf(id: string) {
    setActiveId(id)
    saveActivePdfId(id)
  }

  async function importFiles(selected: File[]) {
    if (!selected.length) return
    setImporting(true)
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
      {activeId
        ? <PdfReader key={activeId} id={activeId} />
        : !loading && !errors && <p>导入 PDF 后即可阅读。</p>}
    </section>
  )
}
