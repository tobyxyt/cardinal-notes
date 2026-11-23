import type { ReactNode } from 'react'
import {
  DefaultColorStyle, DefaultSizeStyle, DefaultStylePanel, DefaultStylePanelContent, ReadonlySharedStyleMap,
  kickoutOccludedShapes, TldrawUiButtonIcon, TldrawUiPopover, TldrawUiPopoverContent, TldrawUiPopoverTrigger,
  useEditor, useReadonly, useRelevantStyles, useValue, type EnumStyleProp,
} from 'tldraw'
import CardColorPalette from './CardColorPalette'
import { useCardPopupAlignment } from './useCardPopupAlignment'

const noSelectionDefaults = [] as const
const sizeLabels = { s: '最细', m: '较细', l: '较粗', xl: '最粗' }
function LinePreview({ weight }: { weight: number }) {
  return (
    <svg className="card-line-preview" viewBox="0 0 24 20" aria-hidden="true">
      <path d="M2 10h20" stroke="currentColor" strokeWidth={weight} strokeLinecap="round" />
    </svg>
  )
}

function InlineStyle<T extends string>({ style, styles, label, labels, preview }: {
  style: EnumStyleProp<T>
  styles: ReadonlySharedStyleMap
  label: string
  labels: Record<T, string>
  preview: (value: T) => ReactNode
}) {
  const editor = useEditor()
  const value = styles.get(style)
  if (!value) return null

  return (
    <div className="card-style-group" role="group" aria-label={label}>
      {style.values.map((option) => (
        <button type="button" className="card-style-option" key={option} aria-label={label + '：' + labels[option]}
          title={label + '：' + labels[option]} aria-pressed={value.type === 'shared' && value.value === option}
          onClick={() => {
            if (value.type === 'shared' && value.value === option) return
            editor.markHistoryStoppingPoint('Card style')
            editor.run(() => {
              if (editor.isIn('select')) {
                editor.setStyleForSelectedShapes(style, option)
                if (style.id === DefaultSizeStyle.id) kickoutOccludedShapes(editor, editor.getSelectedShapeIds())
              } else {
                editor.setStyleForNextShapes(style, option)
              }
            })
          }}>{preview(option)}</button>
      ))}
    </div>
  )
}

export default function CardStyleDock() {
  const editor = useEditor()
  const readonly = useReadonly()
  const { alignOffset, triggerEvents } = useCardPopupAlignment()
  const styles = useRelevantStyles(noSelectionDefaults)
  const isText = useValue('Card text sizing', () =>
    editor.isIn('text') || (editor.isIn('select') && editor.getSelectedShapes().every(({ type }) => type === 'text')),
  [editor])
  const selectionLocked = useValue('Card selection locked', () => {
    const selected = editor.getSelectedShapes()
    return editor.isIn('select') && selected.length > 0 && selected.every((shape) => editor.isShapeOrAncestorLocked(shape))
  }, [editor])
  if (readonly || !styles || selectionLocked) return null

  const advancedStyles = new ReadonlySharedStyleMap(
    [...styles].filter(([style]) => style !== DefaultColorStyle && style !== DefaultSizeStyle),
  )

  return (
    <div className="card-style-dock" role="group" aria-label="Card 样式">
      {styles.get(DefaultColorStyle) && (
        <CardColorPalette selected={styles.getAsKnownValue(DefaultColorStyle)} onSelect={(value) => {
          editor.markHistoryStoppingPoint('Card color')
          editor.run(() => {
            if (editor.isIn('select')) editor.setStyleForSelectedShapes(DefaultColorStyle, value)
            else editor.setStyleForNextShapes(DefaultColorStyle, value)
          })
        }} />
      )}
      <InlineStyle style={DefaultSizeStyle} styles={styles} label={isText ? '字号' : '粗细'}
        labels={isText ? { s: '小', m: '中', l: '大', xl: '特大' } : sizeLabels}
        preview={(size) => <LinePreview weight={{ s: 1, m: 2.2, l: 3.8, xl: 5.4 }[size]} />} />
      <TldrawUiPopover id="card-more-styles">
        <TldrawUiPopoverTrigger>
          <button type="button" className="card-style-option card-more-style-button" aria-label="更多样式" title="更多样式" {...triggerEvents}>
            <TldrawUiButtonIcon icon="dots-horizontal" small />
          </button>
        </TldrawUiPopoverTrigger>
        <TldrawUiPopoverContent side="top" align="end" alignOffset={alignOffset} collisionPadding={8}>
          <div className="card-more-styles" role="group" aria-label="更多样式">
            <DefaultStylePanel styles={advancedStyles} isMobile>
              <DefaultStylePanelContent />
            </DefaultStylePanel>
          </div>
        </TldrawUiPopoverContent>
      </TldrawUiPopover>
    </div>
  )
}
