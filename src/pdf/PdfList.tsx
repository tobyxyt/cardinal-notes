import { useEffect, useRef } from 'react'
import WorkspaceIcon from '../WorkspaceIcon'
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
  const activeTab = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeTab.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  return (
    <div className="pane-tabs pdf-bar">
      <button type="button" className={files.length ? 'tool-button' : 'text-button'} aria-label="导入 PDF" title="导入 PDF"
        disabled={importDisabled} onClick={() => input.current?.click()}>
        <WorkspaceIcon name="import" />
        {!files.length && <span>导入 PDF</span>}
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
      <div className="tab-strip pdf-file-list" role="group" aria-label="PDF 列表">
        {files.map(({ id, name }) => (
          <button key={id} type="button" className="pane-tab tab-label" aria-pressed={id === activeId}
            ref={id === activeId ? activeTab : undefined} title={name} onClick={() => onSelect(id)}>
            {name}
          </button>
        ))}
      </div>
    </div>
  )
}
