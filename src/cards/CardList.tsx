import { useState } from 'react'
import type { Card } from './cardStorage'

type CardListProps = {
  items: Card[]
  activeId: string
  onCreate: () => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onRemove: (card: Card) => void
}

export default function CardList({ items, activeId, onCreate, onSelect, onRename, onRemove }: CardListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <header style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid #ddd' }}>
      <button type="button" onClick={onCreate} style={{ flexShrink: 0 }}>新建 Card</button>
      <div role="group" aria-label="Card 列表" style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
        {items.map((card) => (
          <div key={card.id} style={{ display: 'flex', flexShrink: 0 }}>
            {editingId === card.id ? (
              <input
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
                style={{ fontWeight: card.id === activeId ? 'bold' : 'normal' }}
                onClick={() => onSelect(card.id)}
                onDoubleClick={() => setEditingId(card.id)}
              >
                {card.title}
              </button>
            )}
            <button type="button" aria-label={`删除 ${card.title}`} onClick={() => onRemove(card)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </header>
  )
}
