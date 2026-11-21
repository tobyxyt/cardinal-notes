import { useEffect, useRef, useState } from 'react'
import { importPdf } from './pdfDocument'
import PdfReader from './PdfReader'
import { listPdfs, type PdfFile } from './pdfStorage'
import './pdf.css'

const ACTIVE_PDF = 'cardinal-notes:active-pdf'
const PDFS_IMPORTED = 'cardinal-notes:pdfs-imported'

export default function PdfWorkspace() {
  const input = useRef<HTMLInputElement>(null)
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
        const previous = localStorage.getItem(ACTIVE_PDF)
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
    try {
      localStorage.setItem(ACTIVE_PDF, id)
    } catch {
      // The last selection is optional. The file is already in IndexedDB.
    }
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
      <div className="pdf-bar">
        <button type="button" disabled={loading || importing} onClick={() => input.current?.click()}>
          导入 PDF
        </button>
        <input
          ref={input}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          hidden
          onChange={(event) => {
            const selected = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            void importFiles(selected)
          }}
        />
        <div className="pdf-file-list" role="group" aria-label="PDF 列表">
          {files.map(({ id, name }) => (
            <button key={id} type="button" aria-pressed={id === activeId} onClick={() => selectPdf(id)}>
              {name}
            </button>
          ))}
        </div>
      </div>
      {importing ? <p role="status">正在导入 PDF…</p> : notice && <p role="status">{notice}</p>}
      {errors && <p role="alert">{errors}</p>}
      {activeId
        ? <PdfReader key={activeId} id={activeId} />
        : !loading && !errors && <p>导入 PDF 后即可阅读。</p>}
    </section>
  )
}
