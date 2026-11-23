import { useEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { CardWorkspaceActions } from './cards/CardWorkspace'
import { verifySavedCanvas, waitForCanvasSaves } from './cards/canvasPersistence'
import type { LibraryDocument } from './library/Library'
import BackupControls from './backup/BackupControls'
import { ACTIVE_DATASET_KEY, readActiveDataset, WORKSPACE_LOCK, workspaceDataset } from './dataset'
import WorkspaceIcon from './WorkspaceIcon'
import Editor from './workspace/Editor'
import WorkspaceMenu from './workspace/WorkspaceMenu'
import { Home, Workspaces } from './workspace/WorkspacePages'
import { useWorkspaceSessions } from './workspace/useWorkspaceSessions'
import { useWorkspaceNavigation } from './workspace/useWorkspaceNavigation'
import { clearTabs, readWorkspaces } from './workspace/workspaceStorage'
import './App.css'

function WorkspaceLease({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    let release: (() => void) | undefined
    const controller = new AbortController()
    void navigator.locks.request(WORKSPACE_LOCK, { mode: 'shared', signal: controller.signal }, async () => {
      if (cancelled) return
      if (readActiveDataset() !== workspaceDataset) {
        window.location.reload()
        return
      }
      await new Promise<void>((resolve) => {
        release = resolve
        setReady(true)
      })
    }).catch((error) => {
      if (!cancelled) console.error('Could not open workspace', error)
    })
    return () => {
      cancelled = true
      controller.abort()
      release?.()
    }
  }, [])
  return ready ? children : <p role="status">正在打开本地工作区…</p>
}

export default function App() {
  const cards = useRef<CardWorkspaceActions>(null)
  const [busy, setBusy] = useState(false)
  const [paused, setPaused] = useState(false)
  const [importingPdf, setImportingPdf] = useState(false)
  const sessions = useWorkspaceSessions()
  const { active, commit, update } = sessions
  const [operationError, setOperationError] = useState('')
  const navigation = useWorkspaceNavigation(sessions)
  const { page, goTo, selectWorkspace } = navigation

  function clearWorkspace() {
    if (window.confirm('清空当前工作区打开的标签？Library 文档会保留。')) void update(active.id, clearTabs)
  }

  async function deleteDocument(document: LibraryDocument & { title: string }) {
    if (!window.confirm('永久删除「' + document.title + '」？这将从 Library 和所有工作区移除此文档。')) return
    setOperationError('')
    if (document.kind === 'card') {
      try { await cards.current?.removeCard(document.id) } catch (cause) {
        setOperationError(cause instanceof Error ? cause.message : '无法删除 Card。')
      }
      return
    }
    setBusy(true)
    try {
      const live = cards.current?.captureCanvas()
      if (live === undefined) throw new Error('当前画布还未准备好，请稍后重试。')
      if (live) await verifySavedCanvas(live)
      const { removeUnlinkedPdf } = await import('./library/removeUnlinkedPdf')
      flushSync(() => setPaused(true))
      await waitForCanvasSaves()
      await navigator.locks.request(WORKSPACE_LOCK, { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error('请关闭 Cardinal Notes 的其他标签页后重试。')
        if (readActiveDataset() !== workspaceDataset) throw new Error('当前数据已切换，请刷新后重试。')
        await removeUnlinkedPdf(document.id)
      })
      await commit(() => readWorkspaces())
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : '无法删除 PDF。')
    } finally {
      setPaused(false)
      setBusy(false)
    }
  }

  useEffect(() => {
    function reloadDataset(event: StorageEvent) {
      if (event.key === ACTIVE_DATASET_KEY && readActiveDataset() !== workspaceDataset) window.location.reload()
    }
    window.addEventListener('storage', reloadDataset)
    return () => window.removeEventListener('storage', reloadDataset)
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header" data-editor={page === 'editor' ? '' : undefined}>
        <nav className="app-header-start app-pages" aria-label="主导航">
          <button type="button" className="tool-button home-button" aria-label="Home" title="Home"
            aria-current={page === 'home' ? 'page' : undefined} disabled={busy} onClick={() => goTo('home')}>
            <WorkspaceIcon name="home" />
          </button>
          {page !== 'editor' && (
            <>
              <button type="button" className="text-button" aria-current={page === 'library' ? 'page' : undefined}
                disabled={busy} onClick={() => goTo('library')}>Library</button>
              <button type="button" className="text-button" aria-current={page === 'workspaces' ? 'page' : undefined}
                disabled={busy} onClick={() => goTo('workspaces')}>Workspaces</button>
            </>
          )}
        </nav>
        {page === 'editor' && (
          <WorkspaceMenu active={active} items={sessions.items} disabled={busy || importingPdf}
            onSelect={selectWorkspace} onClear={clearWorkspace} />
        )}
        <BackupControls
          disabled={importingPdf}
          captureCanvas={() => cards.current?.captureCanvas()}
          setBusy={setBusy}
          setPaused={setPaused}
        />
      </header>
      {(operationError || sessions.error) && <div className="workspace-error" role="alert">
        <span>{operationError || sessions.error}</span>
        {operationError && <button type="button" className="tool-button" aria-label="关闭错误"
          onClick={() => setOperationError('')}><WorkspaceIcon name="close" /></button>}
      </div>}
      <div className="app-workspace" inert={busy}>
        {page === 'home' && <Home onLibrary={() => goTo('library')} onWorkspaces={() => goTo('workspaces')} />}
        {page === 'workspaces' && <Workspaces items={sessions.items} disabled={importingPdf}
          onSelect={selectWorkspace} onCreate={navigation.createWorkspace} onRename={navigation.renameWorkspace}
          onDelete={navigation.deleteWorkspace} />}
        {!paused && (
          <WorkspaceLease>
            <Editor
              cards={cards}
              onPdfImportingChange={setImportingPdf}
              sessions={sessions}
              page={page}
              onOpenDocument={navigation.openLibraryDocument}
              onDeleteDocument={(document) => void deleteDocument(document)}
            />
          </WorkspaceLease>
        )}
      </div>
    </div>
  )
}
