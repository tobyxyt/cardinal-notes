import { useEffect, useRef } from 'react'
import WorkspaceIcon from '../WorkspaceIcon'
import type { PdfFile } from './pdfStorage'

type PdfListProps = {
  files: PdfFile[]
  activeId: string
  importDisabled: boolean
  onImport: () => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
}

export default function PdfList({ files, activeId, importDisabled, onImport, onSelect, onClose }: PdfListProps) {
  const activeTab = useRef<HTMLDivElement>(null)
  const importButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeTab.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  return (
    <div className="pane-tabs pdf-bar">
      <button type="button" className={files.length ? 'tool-button' : 'text-button'} aria-label="导入 PDF" title="导入 PDF" ref={importButton}
        disabled={importDisabled} onClick={onImport}>
        <WorkspaceIcon name="import" />
        {!files.length && <span>导入 PDF</span>}
      </button>
      <div className="tab-strip pdf-file-list" role="group" aria-label="已打开的 PDF">
        {files.map(({ id, name }) => (
          <div key={id} className="pane-tab" data-active={id === activeId ? '' : undefined}
            ref={id === activeId ? activeTab : undefined}>
            <button type="button" className="tab-label" aria-pressed={id === activeId} title={name} onClick={() => onSelect(id)}>
              {name}
            </button>
            <button type="button" className="tab-close" aria-label={`关闭 ${name}`} title="关闭标签"
              onClick={() => {
                const next = id === activeId
                  ? activeTab.current?.nextElementSibling ?? activeTab.current?.previousElementSibling
                  : activeTab.current
                if (next) next.querySelector('button')?.focus()
                else importButton.current?.focus()
                onClose(id)
              }}>
              <WorkspaceIcon name="close" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
