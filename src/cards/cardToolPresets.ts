import {
  ArrowShapeArrowheadEndStyle, ArrowShapeArrowheadStartStyle, ArrowShapeKindStyle, DefaultColorStyle,
  DefaultDashStyle, DefaultFillStyle, DefaultFontStyle, DefaultHorizontalAlignStyle,
  DefaultSizeStyle, DefaultTextAlignStyle, DefaultVerticalAlignStyle, LineShapeSplineStyle, react,
  type Editor, type StyleProp, type TLUiToolItem,
} from 'tldraw'

const STORAGE_KEY = 'cardinal-notes:card-tool-presets'
type Category = 'draw' | 'text' | 'highlight' | 'shape'
type Preset = Record<string, unknown>

// The geometric variant is owned by the native tool picker, so Shape can share styling without
// a rectangle preset turning the ellipse or arrow tool into something else.
const presetStyles: readonly StyleProp<unknown>[] = [
  DefaultColorStyle, DefaultSizeStyle, DefaultDashStyle, DefaultFillStyle, DefaultFontStyle,
  DefaultTextAlignStyle, DefaultHorizontalAlignStyle, DefaultVerticalAlignStyle,
  ArrowShapeKindStyle, ArrowShapeArrowheadStartStyle, ArrowShapeArrowheadEndStyle, LineShapeSplineStyle,
]

function categoryFor(tool: string): Category | undefined {
  if (tool === 'draw' || tool === 'text' || tool === 'highlight') return tool
  if (tool === 'geo' || tool === 'arrow' || tool === 'line' || tool === 'note' || tool === 'frame') return 'shape'
}

function object(value: unknown): Preset {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
}

function readPresets() {
  try { return object(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')) }
  catch { return {} }
}

function saveChanges(category: Category, changes: Preset) {
  const all = readPresets()
  all[category] = { ...object(all[category]), ...changes }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)) }
  catch { /* The current tool can still use its in-editor defaults. */ }
}

function restore(editor: Editor, category: Category, styles: readonly StyleProp<unknown>[]) {
  const preset = object(readPresets()[category])
  const expected: Preset = {}
  for (const style of styles) {
    const saved = preset[style.id]
    expected[style.id] = style.defaultValue
    if (saved !== undefined) {
      try { expected[style.id] = style.validate(saved) }
      catch { /* Use the SDK default when a saved value is no longer valid. */ }
    }
  }
  const opacity = preset.opacity
  const targetOpacity = typeof opacity === 'number' && opacity >= 0 && opacity <= 1 ? opacity : 1
  expected.opacity = targetOpacity
  editor.run(() => {
    for (const style of styles) {
      if (editor.getStyleForNextShape(style) !== expected[style.id]) {
        editor.setStyleForNextShapes(style, expected[style.id])
      }
    }
    editor.setOpacityForNextShapes(targetOpacity)
  }, { history: 'ignore' })
  return expected
}

export function watchCardToolPresets(editor: Editor) {
  let activeTool: string | undefined
  let previous: Preset = {}

  // Run synchronously so a shortcut followed by an immediate pointer gesture sees the new defaults.
  return react('Card tool presets', () => {
    const tool = editor.getCurrentToolId()
    const category = editor.isIn('select') ? undefined : categoryFor(tool)
    if (!category) {
      activeTool = undefined
      return
    }

    const shared = editor.getSharedStyles()
    const supported = presetStyles.filter((style) => shared.get(style) !== undefined)
    const opacity = editor.getSharedOpacity()
    if (tool !== activeTool) {
      activeTool = tool
      previous = restore(editor, category, supported)
      return
    }

    const changes: Preset = {}
    for (const style of supported) {
      const value = shared.getAsKnownValue(style)
      if (value !== undefined && value !== previous[style.id]) changes[style.id] = value
    }
    if (opacity.type === 'shared' && opacity.value !== previous.opacity) changes.opacity = opacity.value
    if (Object.keys(changes).length) {
      previous = { ...previous, ...changes }
      saveChanges(category, changes)
    }
  })
}

export function withCardToolDragPreset(editor: Editor, tool: TLUiToolItem): TLUiToolItem {
  const category = categoryFor(tool.meta?.geo ? 'geo' : tool.id)
  const drag = tool.onDragStart
  if (!category || !drag) return tool

  return {
    ...tool,
    onDragStart(source, info) {
      if (editor.getIsReadonly()) return
      // Dragging directly out of the toolbar creates the shape before activating the tool.
      // Keep the temporary defaults and the native transition to selection in one transaction.
      editor.run(() => {
        restore(editor, category, presetStyles)
        drag(source, info)
      })
    },
  }
}
