import { useCallback, useEffect, useState } from 'react'
import {
  changeSession, readCheckpoint, readLegacyWorkspace, readWorkspaces, READING_CHECKPOINT, saveView, updateWorkspaces, WORKSPACES_KEY,
  type WorkspaceData, type WorkspaceSession,
} from './workspaceStorage'

export function useWorkspaceSessions() {
  const [data, setData] = useState(() => {
    try {
      const stored = readWorkspaces()
      const pending = readCheckpoint()
      return pending ? changeSession(stored, pending.workspaceId, (session) =>
        saveView(session, pending.pdfId, pending.view)) : stored
    } catch {
      return readLegacyWorkspace()
    }
  })
  const [selectedId, setSelectedId] = useState(data.activeId)
  const [error, setError] = useState('')
  const active = data.items.find(({ id }) => id === selectedId) ?? data.items.find(({ id }) => id === data.activeId)!

  const commit = useCallback(async (change: (data: WorkspaceData) => WorkspaceData | Promise<WorkspaceData>, select = false) => {
    try {
      const next = await updateWorkspaces(change)
      setData(next)
      if (select) setSelectedId(next.activeId)
      setError('')
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存工作区。')
      return false
    }
  }, [])

  const update = useCallback((id: string, change: (session: WorkspaceSession) => WorkspaceSession) =>
    commit((current) => changeSession(current, id, change)), [commit])

  useEffect(() => {
    const pending = readCheckpoint()
    void commit((current) => pending ? changeSession(current, pending.workspaceId, (session) =>
      saveView(session, pending.pdfId, pending.view)) : current).then((saved) => {
      if (saved && pending && readCheckpoint()?.view.at === pending.view.at) {
        try { sessionStorage.removeItem(READING_CHECKPOINT) } catch { /* optional checkpoint */ }
      }
    })
    function sync(event: StorageEvent) {
      if (event.key !== WORKSPACES_KEY || event.newValue === null) return
      try {
        const latest = readWorkspaces()
        setData(latest)
        setSelectedId((id) => latest.items.some((item) => item.id === id) ? id : latest.activeId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '无法读取工作区。')
      }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [commit])

  return { active, items: data.items, commit, update, error }
}
