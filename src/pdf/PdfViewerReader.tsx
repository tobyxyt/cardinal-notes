import PdfReader, { type PdfReaderProps } from './PdfReader'
import PdfViewerTools from './PdfViewerTools'
import './pdfViewer.css'

export default function PdfViewerReader(props: PdfReaderProps) {
  return <PdfReader {...props} ViewerTools={PdfViewerTools} />
}
