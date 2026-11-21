import { useRef } from 'react'
import type { PdfFile } from './pdfStorage'

type PdfListProps = {
  files: PdfFile[]
  activeId: string
  importDisabled: boolean
  onImport: (files: File[]) => void
  onSelect: (id: string) => void
}

export default function PdfList({ files, activeId, importDisabled, onImport, onSelect }: PdfListProps) {
  const input = useRef<HTMLInputElement>(null)

  return (
    <div className="pdf-bar">
      <button type="button" disabled={importDisabled} onClick={() => input.current?.click()}>
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
          onImport(selected)
        }}
      />
      <div className="pdf-file-list" role="group" aria-label="PDF 列表">
        {files.map(({ id, name }) => (
          <button key={id} type="button" aria-pressed={id === activeId} onClick={() => onSelect(id)}>
            {name}
          </button>
        ))}
      </div>
    </div>
  )
}
