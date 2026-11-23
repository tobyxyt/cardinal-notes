import { useRef, useState, type FormEvent } from 'react'
import WorkspaceIcon from '../WorkspaceIcon'
import { GENERAL_WORKSPACE, type WorkspaceSession } from './workspaceStorage'

export default function WorkspaceMenu({
  active, items, disabled, onSelect, onCreate, onRename, onDelete, onClear,
}: {
  active: WorkspaceSession
  items: WorkspaceSession[]
  disabled: boolean
  onSelect: (id: string) => void
  onCreate: (name: string) => void
  onRename: (name: string) => void
  onDelete: () => void
  onClear: () => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState<'create' | 'rename' | null>(null)
  const [name, setName] = useState('')
  const general = active.id === GENERAL_WORKSPACE
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) return
    if (form === 'create') onCreate(name.trim())
    else onRename(name.trim())
    menu.current?.hidePopover()
  }
  return (
    <>
      <button type="button" className="tool-button workspace-menu-trigger" aria-label="管理工作区" title="管理工作区"
        disabled={disabled} popoverTarget="workspace-sessions">
        <WorkspaceIcon name="down" />
      </button>
      <div className="workspace-menu workspace-sessions" ref={menu} id="workspace-sessions" popover="auto"
        role="group" aria-label="工作区管理" onToggle={(event) => { if (event.newState === 'closed') setForm(null) }}>
        <div className="workspace-session-list">
          {[...items].sort((a, b) => Number(b.id === GENERAL_WORKSPACE) - Number(a.id === GENERAL_WORKSPACE)).map(({ id, name }) => (
            <button type="button" key={id} aria-current={id === active.id ? 'true' : undefined}
              onClick={() => { onSelect(id); menu.current?.hidePopover() }}>
              <WorkspaceIcon name="split" /><span title={name}>{name}</span>
            </button>
          ))}
        </div>
        {form ? (
          <form onSubmit={submit} className="workspace-session-form">
            <input type="text" aria-label="工作区名称" placeholder="工作区名称" autoFocus required
              value={name} onChange={(event) => setName(event.currentTarget.value)} />
            <button type="submit">保存工作区</button>
            <button type="button" onClick={() => setForm(null)}>取消</button>
          </form>
        ) : (
          <div className="workspace-session-actions">
            <button type="button" onClick={() => { setName(''); setForm('create') }}>新建工作区</button>
            <button type="button" disabled={general} onClick={() => { setName(active.name); setForm('rename') }}>重命名工作区</button>
            <button type="button" disabled={!active.pdf.ids.length && !active.card.ids.length}
              onClick={() => { onClear(); menu.current?.hidePopover() }}>清空打开的标签</button>
            <button type="button" disabled={general}
              onClick={() => { menu.current?.hidePopover(); onDelete() }}>删除工作区</button>
          </div>
        )}
      </div>
    </>
  )
}
