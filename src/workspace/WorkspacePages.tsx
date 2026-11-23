import { useState, type FormEvent } from 'react'
import WorkspaceIcon from '../WorkspaceIcon'
import { GENERAL_WORKSPACE, type WorkspaceSession } from './workspaceStorage'
import './workspacePages.css'

export function Home({ onLibrary, onWorkspaces }: { onLibrary: () => void; onWorkspaces: () => void }) {
  return (
    <main className="workspace-page" aria-label="Home">
      <div className="workspace-page-content">
        <div className="home-heading"><span className="brand-mark" aria-hidden="true">C</span><h1>Cardinal Notes</h1></div>
        <div className="home-entries">
          <button type="button" onClick={onLibrary}>
            <WorkspaceIcon name="library" /><strong>Library</strong><span>浏览和管理 PDF 与 Card</span>
          </button>
          <button type="button" onClick={onWorkspaces}>
            <WorkspaceIcon name="split" /><strong>Workspaces</strong><span>打开或管理工作区</span>
          </button>
        </div>
      </div>
    </main>
  )
}

export function Workspaces({ items, disabled, onSelect, onCreate, onRename, onDelete }: {
  items: WorkspaceSession[]
  disabled: boolean
  onSelect: (id: string) => void
  onCreate: (name: string) => Promise<boolean>
  onRename: (id: string, name: string) => Promise<boolean>
  onDelete: (session: WorkspaceSession) => void
}) {
  const [form, setForm] = useState<{ id?: string; name: string } | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = form?.name.trim()
    if (!name || disabled || saving) return
    setSaving(true)
    if (form?.id) {
      if (await onRename(form.id, name)) setForm(null)
      setSaving(false)
    } else if (!(await onCreate(name))) {
      setSaving(false)
    }
  }

  return (
    <main className="workspace-page" aria-label="Workspaces">
      <div className="workspace-page-content">
        <header className="workspace-page-heading">
          <h1>Workspaces</h1>
          <button type="button" className="text-button workspace-add" disabled={disabled || saving}
            onClick={() => setForm({ name: '' })}><WorkspaceIcon name="plus" />新建工作区</button>
        </header>
        {form && (
          <form className="workspace-page-form" onSubmit={(event) => void submit(event)}>
            <label>
              <span>工作区名称</span>
              <input key={form.id ?? 'new'} name="workspace-name" value={form.name} autoFocus required disabled={saving}
                onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} />
            </label>
            <button type="submit" className="text-button workspace-add" disabled={disabled || saving}>保存工作区</button>
            <button type="button" className="text-button" disabled={saving} onClick={() => setForm(null)}>取消</button>
          </form>
        )}
        <ul className="workspace-rows">
          {[...items].sort((a, b) => Number(b.id === GENERAL_WORKSPACE) - Number(a.id === GENERAL_WORKSPACE)).map((session) => (
            <li key={session.id}>
              <button type="button" className="workspace-row-open" aria-label={session.name} disabled={disabled || saving}
                onClick={() => onSelect(session.id)}>
                <WorkspaceIcon name="split" />
                <span><strong title={session.name}>{session.name}</strong>
                  <small>{session.pdf.ids.length} PDF · {session.card.ids.length} Card</small></span>
              </button>
              {session.id !== GENERAL_WORKSPACE && <>
                <button type="button" className="tool-button" aria-label={'重命名 ' + session.name} title="重命名工作区"
                  disabled={disabled || saving} onClick={() => setForm({ id: session.id, name: session.name })}><WorkspaceIcon name="rename" /></button>
                <button type="button" className="tool-button" aria-label={'删除 ' + session.name} title="删除工作区"
                  disabled={disabled || saving} onClick={() => { if (form?.id === session.id) setForm(null); onDelete(session) }}><WorkspaceIcon name="trash" /></button>
              </>}
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
