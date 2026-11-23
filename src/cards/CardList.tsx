import { useEffect, useRef, useState } from 'react'
import WorkspaceIcon from '../WorkspaceIcon'
import type { Card } from './cardStorage'

type CardListProps = {
  hasUnknownReferences: boolean
  items: Card[]
  available: Card[]
  activeId: string
  onCreate: () => void
  onStartPdfRegion: () => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onClose: (cardId: string) => void
}

export default function CardList({
  hasUnknownReferences, items, available, activeId, onCreate, onStartPdfRegion, onSelect, onRename, onClose,
}: CardListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const activeTab = useRef<HTMLDivElement>(null)
  useEffect(() => {
    activeTab.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  return (
    <header className="pane-tabs card-tabs">
      <button type="button" className="tool-button" aria-label="新建 Card" title="新建 Card" onClick={onCreate}>
        <WorkspaceIcon name="plus" />
      </button>
      <select className="card-open-select library-select" value="" aria-label="打开已有 Card" title="打开已有 Card"
        disabled={!available.length} onChange={(event) => { if (event.currentTarget.value) onSelect(event.currentTarget.value) }}>
        <option value="">打开 Card</option>
        {available.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
      </select>
      <div className="tab-strip" role="group" aria-label="Card 列表">
        {items.map((card) => (
          <div key={card.id} className="pane-tab" data-active={card.id === activeId ? '' : undefined}
            ref={card.id === activeId ? activeTab : undefined}>
            {editingId === card.id ? (
              <input
                className="tab-edit"
                aria-label="Card 标题"
                autoFocus
                defaultValue={card.title}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={() => setEditingId(null)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return
                  if (event.key === 'Enter') {
                    setEditingId(null)
                    onRename(card.id, event.currentTarget.value)
                  }
                  if (event.key === 'Escape') setEditingId(null)
                }}
              />
            ) : (
              <button
                type="button"
                aria-pressed={card.id === activeId}
                className="tab-label"
                title={card.title}
                onKeyDown={(event) => {
                  if (event.key === 'F2') {
                    event.preventDefault()
                    setEditingId(card.id)
                  }
                }}
                onClick={() => onSelect(card.id)}
                onDoubleClick={() => setEditingId(card.id)}
              >
                {card.title}
              </button>
            )}
            <button type="button" className="tab-close" aria-label={`关闭 ${card.title}`} title="关闭标签"
              onClick={() => onClose(card.id)}>
              <WorkspaceIcon name="close" />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="tool-button" aria-label="插入 PDF 选区" title="插入 PDF 选区" disabled={!activeId}
        onClick={onStartPdfRegion}>
        <WorkspaceIcon name="insert" />
      </button>
      {hasUnknownReferences && <small className="card-reference-status" role="status">部分 PDF 引用尚未确认。</small>}
    </header>
  )
}
