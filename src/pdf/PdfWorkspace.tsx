import { useMemo } from 'react'
import WorkspaceIcon from '../WorkspaceIcon'
import PdfList from './PdfList'
import PdfReader from './PdfReader'
import type { PdfRegion, PdfRegionMode, PdfRegionReference } from './pdfRegion'
import type { PdfWorkspaceState } from './usePdfWorkspace'
import './pdf.css'

type PdfWorkspaceProps = {
  pdf: PdfWorkspaceState
  onImport: () => void
  selectionMode: PdfRegionMode | null
  onStartSelection: () => void
  onCancelSelection: () => void
  onConfirmRegion: (region: PdfRegion) => void
  references: PdfRegionReference[]
  onOpenCard: (cardId: string) => void
}

export default function PdfWorkspace({ pdf, onImport, ...props }: PdfWorkspaceProps) {
  const { files, openFiles, activeId, loading, importing, notice, errors, sourceError, destination } = pdf
  const references = useMemo(() => props.references.filter(({ region }) => region.pdfId === activeId),
    [props.references, activeId])

  return (
    <section className="pdf-workspace" aria-label="PDF 阅读">
      <PdfList
        files={openFiles}
        activeId={activeId}
        importDisabled={loading || importing}
        onImport={onImport}
        onSelect={pdf.selectPdf}
        onClose={pdf.closePdf}
      />
      {importing ? <p role="status">正在导入 PDF…</p> : notice && <p role="status">{notice}</p>}
      {errors && <p role="alert">{errors}</p>}
      {sourceError && <p role="alert">{sourceError}</p>}
      {activeId
        ? <PdfReader key={activeId} id={activeId} {...props} references={references} destination={destination} />
        : !loading && !errors && (
          <div className="pdf-empty">
            <span className="pdf-empty-icon"><WorkspaceIcon name="pdf" /></span>
            <strong>{files.length ? '选择 PDF 开始阅读' : '暂无 PDF'}</strong>
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
