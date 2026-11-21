import { lazy, Suspense, useState } from 'react'
import CardWorkspace from './cards/CardWorkspace'

const PdfWorkspace = lazy(() => import('./pdf/PdfWorkspace'))

export default function App() {
  const [workspace, setWorkspace] = useState<'cards' | 'pdf'>(() =>
    localStorage.getItem('cardinal-notes:workspace') === 'pdf' ? 'pdf' : 'cards',
  )

  function selectWorkspace(next: 'cards' | 'pdf') {
    setWorkspace(next)
    try {
      localStorage.setItem('cardinal-notes:workspace', next)
    } catch {
      // The view preference is optional.
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
      <nav aria-label="工作区" style={{ display: 'flex', gap: 4, padding: 8, borderBottom: '1px solid #ddd' }}>
        <button type="button" aria-pressed={workspace === 'cards'} onClick={() => selectWorkspace('cards')}>
          Card 编辑
        </button>
        <button type="button" aria-pressed={workspace === 'pdf'} onClick={() => selectWorkspace('pdf')}>
          PDF 阅读
        </button>
      </nav>
      <div style={{ minWidth: 0, minHeight: 0 }}>
        {workspace === 'cards' ? <CardWorkspace /> : (
          <Suspense fallback={<p role="status">正在加载 PDF 阅读器…</p>}>
            <PdfWorkspace />
          </Suspense>
        )}
      </div>
    </div>
  )
}
