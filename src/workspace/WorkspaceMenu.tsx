import { useRef } from 'react'
import WorkspaceIcon from '../WorkspaceIcon'
import { GENERAL_WORKSPACE, type WorkspaceSession } from './workspaceStorage'

export default function WorkspaceMenu({ active, items, disabled, onSelect, onClear }: {
  active: WorkspaceSession
  items: WorkspaceSession[]
  disabled: boolean
  onSelect: (id: string) => void
  onClear: () => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  return (
    <>
      <button type="button" className="text-button workspace-menu-trigger" aria-current="page"
        title={active.name + ' · 切换工作区'} disabled={disabled} popoverTarget="workspace-sessions">
        <span>{active.name}</span><WorkspaceIcon name="down" />
      </button>
      <div className="workspace-menu workspace-sessions" ref={menu} id="workspace-sessions" popover="auto"
        role="group" aria-label="切换工作区">
        <div className="workspace-session-list">
          {[...items].sort((a, b) => Number(b.id === GENERAL_WORKSPACE) - Number(a.id === GENERAL_WORKSPACE)).map(({ id, name }) => (
            <button type="button" key={id} aria-current={id === active.id ? 'true' : undefined}
              onClick={() => { onSelect(id); menu.current?.hidePopover() }}>
              <WorkspaceIcon name="split" /><span title={name}>{name}</span>
            </button>
          ))}
        </div>
        <button type="button" disabled={!active.pdf.ids.length && !active.card.ids.length}
          onClick={() => { onClear(); menu.current?.hidePopover() }}>清空打开的标签</button>
      </div>
    </>
  )
}
