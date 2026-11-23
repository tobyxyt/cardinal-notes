import { useRef, useState, type PointerEvent } from 'react'
import {
  DefaultColorStyle, TldrawUiButtonIcon, TldrawUiPopover, TldrawUiPopoverContent, TldrawUiPopoverTrigger,
  useEditor, useValue, type TLDefaultColorStyle as Color,
} from 'tldraw'
import { useCardPopupAlignment } from './useCardPopupAlignment'

const PALETTE_KEY = 'cardinal-notes:card-favorite-colors'
const initialColors: Color[] = ['black', 'blue', 'red', 'green', 'yellow']
const names: Record<Color, string> = {
  black: '黑色', grey: '灰色', 'light-violet': '浅紫', violet: '紫色', blue: '蓝色', 'light-blue': '浅蓝',
  yellow: '黄色', orange: '橙色', green: '绿色', 'light-green': '浅绿', 'light-red': '浅红', red: '红色', white: '白色',
}

function loadFavorites() {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PALETTE_KEY) ?? 'null')
    if (Array.isArray(saved)) {
      return [...new Set(saved.flatMap((value: unknown) => DefaultColorStyle.values.find((color) => color === value) ?? []))]
    }
  } catch { /* Retain usable defaults if preference storage is unavailable. */ }
  return initialColors
}

function moveColor(colors: Color[], from: Color, to: Color) {
  const index = colors.indexOf(to)
  if (index < 0 || from === to || !colors.includes(from)) return colors
  const next = colors.filter((color) => color !== from)
  next.splice(index, 0, from)
  return next
}

export default function CardColorPalette({ selected, onSelect }: {
  selected: Color | undefined
  onSelect: (color: Color) => void
}) {
  const editor = useEditor()
  const { alignOffset, triggerEvents } = useCardPopupAlignment()
  const palette = useValue('Card palette colors', () => editor.getCurrentTheme().colors[editor.getColorMode()], [editor])
  const [favorites, setFavorites] = useState(loadFavorites)
  const [preview, setPreview] = useState<Color>()
  const [error, setError] = useState(false)
  const row = useRef<HTMLDivElement>(null)
  const drag = useRef<{ color: Color; pointerId: number; x: number; y: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  function save(next: Color[]) {
    setFavorites(next)
    try {
      localStorage.setItem(PALETTE_KEY, JSON.stringify(next))
      setError(false)
    } catch {
      setError(true)
    }
  }

  function targetColor(event: PointerEvent<HTMLButtonElement>) {
    const item = row.current?.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-card-favorite]')
    if (!item || !row.current?.contains(item)) return undefined
    return favorites.find((color) => color === item.dataset.cardFavorite)
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    current.moved ||= Math.hypot(event.clientX - current.x, event.clientY - current.y) >= 7
    if (current.moved) setPreview(targetColor(event))
  }

  function finish(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    setPreview(undefined)
    const target = targetColor(event)
    if (current.moved) {
      suppressClick.current = true
      if (target) save(moveColor(favorites, current.color, target))
    } else if (event.pointerType === 'touch') {
      // A browser can suppress the synthetic click on the first tap after a drag.
      suppressClick.current = true
      if (target === current.color) onSelect(current.color)
    }
  }

  const swatch = (color: Color) => <span className="card-color-swatch" aria-hidden="true" style={{ backgroundColor: palette[color].solid }} />

  return (
    <div className="card-style-group card-favorite-colors" role="group" aria-label="常用颜色" ref={row}>
      {favorites.map((color, index) => (
        <button className="card-style-option card-favorite-swatch" key={color} type="button"
          aria-label={names[color]} title={names[color] + ' · 拖动排序（Alt + 方向键）'} aria-pressed={selected === color}
          data-card-favorite={color} data-drop-target={preview === color ? '' : undefined}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return
            suppressClick.current = false
            drag.current = { color, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={move} onPointerUp={finish}
          onLostPointerCapture={() => { drag.current = null; setPreview(undefined) }}
          onKeyDown={(event) => {
            if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
            event.preventDefault()
            event.stopPropagation()
            const next = favorites[index + (event.key === 'ArrowLeft' ? -1 : 1)]
            if (next) save(moveColor(favorites, color, next))
          }}
          onClick={(event) => {
            if (event.detail && suppressClick.current) return
            onSelect(color)
          }}>{swatch(color)}</button>
      ))}
      <TldrawUiPopover id="card-all-colors">
        <TldrawUiPopoverTrigger>
          <button className="card-style-option" type="button" aria-label="全部颜色" title="全部颜色与收藏" {...triggerEvents}>
            <TldrawUiButtonIcon icon="plus" small />
          </button>
        </TldrawUiPopoverTrigger>
        <TldrawUiPopoverContent side="top" align="end" alignOffset={alignOffset} collisionPadding={8}>
          <div className="card-color-picker" role="group" aria-label="全部原生颜色">
            <div className="card-palette-label">全部颜色 <small>星标添加或移出常用色</small></div>
            <div className="card-color-grid">
              {DefaultColorStyle.values.map((color) => {
                const favorite = favorites.includes(color)
                return (
                  <div className="card-color-cell" key={color}>
                    <button type="button" className="card-style-option" aria-label={names[color]} title={names[color]}
                      aria-pressed={selected === color} onClick={() => onSelect(color)}>
                      {swatch(color)}
                    </button>
                    <button type="button" className="card-color-favorite-toggle"
                      title={favorite ? '移出常用颜色' : '加入常用颜色'} aria-pressed={favorite}
                      aria-label={favorite ? '移出常用颜色：' + names[color] : '加入常用颜色：' + names[color]}
                      onClick={() => save(favorite ? favorites.filter((item) => item !== color) : [...favorites, color])}>
                      <span aria-hidden="true">{favorite ? '★' : '☆'}</span>
                    </button>
                  </div>
                )
              })}
            </div>
            {error && <p role="status">常用颜色无法保存到此浏览器。</p>}
          </div>
        </TldrawUiPopoverContent>
      </TldrawUiPopover>
    </div>
  )
}
