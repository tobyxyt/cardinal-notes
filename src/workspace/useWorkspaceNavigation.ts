import { useRef, useState } from 'react'
import type { LibraryDocument } from '../library/Library'
import type { useWorkspaceSessions } from './useWorkspaceSessions'
import { changeSession, GENERAL_WORKSPACE, newWorkspace, showPane, updateTab, type WorkspaceData, type WorkspaceSession } from './workspaceStorage'

export type Page = 'home' | 'library' | 'workspaces' | 'editor'

export function useWorkspaceNavigation({ lastUsedId, commit, update }: ReturnType<typeof useWorkspaceSessions>) {
  const [page, setPage] = useState<Page>(() => lastUsedId ? 'editor' : 'home')
  const navigation = useRef(0)

  function goTo(page: Exclude<Page, 'editor'>) {
    navigation.current += 1
    setPage(page)
  }

  async function enterEditor(change: (data: WorkspaceData) => WorkspaceData) {
    const request = ++navigation.current
    const saved = await commit(change, true)
    if (saved && request === navigation.current) setPage('editor')
    return saved
  }

  function selectWorkspace(id: string) {
    return enterEditor((data) => {
      if (!data.items.some((item) => item.id === id)) throw new Error('该工作区已不存在。')
      return { ...data, activeId: id }
    })
  }

  function createWorkspace(name: string) {
    const session = newWorkspace(crypto.randomUUID(), name)
    return enterEditor((data) => ({ activeId: session.id, items: [...data.items, session] }))
  }

  function renameWorkspace(id: string, name: string) {
    if (id === GENERAL_WORKSPACE) return Promise.resolve(false)
    return update(id, (session) => ({ ...session, name }))
  }

  function deleteWorkspace({ id, name }: WorkspaceSession) {
    if (id === GENERAL_WORKSPACE ||
        !window.confirm('删除工作区「' + name + '」？只删除工作区配置，Library 文档会保留。')) return
    void commit((data) => ({
      activeId: data.activeId === id ? null : data.activeId,
      items: data.items.filter((item) => item.id !== id),
    }))
  }

  function openLibraryDocument({ id, kind }: LibraryDocument) {
    void enterEditor((data) => ({
      ...changeSession(data, GENERAL_WORKSPACE, (session) => showPane(updateTab(session, kind, id, true), kind)),
      activeId: GENERAL_WORKSPACE,
    }))
  }

  return { page, goTo, selectWorkspace, createWorkspace, renameWorkspace, deleteWorkspace, openLibraryDocument }
}
