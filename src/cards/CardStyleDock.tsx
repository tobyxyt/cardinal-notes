import type { ReactNode } from 'react'
import {
  ArrowShapeArrowheadEndStyle, ArrowShapeArrowheadStartStyle, ArrowShapeKindStyle, DefaultColorStyle,
  DefaultDashStyle, DefaultFillStyle, DefaultFontStyle, DefaultSizeStyle, DefaultStylePanel,
  DefaultHorizontalAlignStyle, DefaultTextAlignStyle, DefaultVerticalAlignStyle, GeoShapeGeoStyle, LineShapeSplineStyle,
  kickoutOccludedShapes, StylePanelArrowheadPicker, StylePanelGeoShapePicker, StylePanelLabelAlignPicker,
  StylePanelSection, TldrawUiButtonIcon, TldrawUiPopover, TldrawUiPopoverContent, TldrawUiPopoverTrigger,
  useEditor, useReadonly, useRelevantStyles, useValue, type EnumStyleProp, type ReadonlySharedStyleMap,
} from 'tldraw'
import CardColorPalette from './CardColorPalette'
import { useCardPopupAlignment } from './useCardPopupAlignment'

const noSelectionDefaults = [] as const
const sizeLabels = { s: '最细', m: '较细', l: '较粗', xl: '最粗' }
const fontLabels = { draw: '手写', sans: '无衬线', serif: '衬线', mono: '等宽' }
const dashLabels = { draw: '手绘线', solid: '实线', dashed: '虚线', dotted: '点线', none: '无描边' }
const fillLabels = { none: '无填充', semi: '背景色', solid: '纯色', pattern: '网纹', fill: '实色填充', 'lined-fill': '条纹填充' }
const textAlignLabels = { start: '左对齐', middle: '居中', end: '右对齐' }
const opacityKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']

function LinePreview({ weight = 2, dash = 'solid' }: { weight?: number; dash?: keyof typeof dashLabels }) {
  return (
    <svg className="card-line-preview" viewBox="0 0 24 20" fill="none" aria-hidden="true">
      {dash === 'none' ? <path d="m8 6 8 8M16 6l-8 8" stroke="currentColor" strokeWidth="1.4" /> : (
        <path d={dash === 'draw' ? 'M2 11q3-4 7-1t5 0 8-1' : 'M2 10h20'}
          stroke="currentColor" strokeWidth={weight} strokeLinecap="round"
          strokeDasharray={dash === 'dashed' ? '4 3' : dash === 'dotted' ? '0.1 3.8' : undefined} />
      )}
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
          onClick={(event) => {
            if (value.type === 'shared' && value.value === option) return
            editor.markHistoryStoppingPoint('Card style')
            editor.run(() => {
              if (editor.isIn('select')) editor.setStyleForSelectedShapes(style, option)
              if (!(editor.getSelectedShapeIds().length && (event.metaKey || event.ctrlKey))) {
                editor.setStyleForNextShapes(style, option)
              }
              if (style.id === DefaultSizeStyle.id) kickoutOccludedShapes(editor, editor.getSelectedShapeIds())
            })
          }}>{preview(option)}</button>
      ))}
    </div>
  )
}

function OpacityControl() {
  const editor = useEditor()
  const opacity = useValue('Card opacity', () => editor.getSharedOpacity(), [editor])
  const percentage = opacity.type === 'shared' ? Math.round(opacity.value * 100) : 100
  return (
    <label className="card-style-group card-opacity" title="不透明度">
      <span aria-hidden="true" className="card-opacity-symbol" />
      <input type="range" min="0" max="100" step="1" value={percentage} aria-label="不透明度"
        aria-valuetext={opacity.type === 'mixed' ? '混合' : percentage + '%'}
        onPointerDown={() => editor.markHistoryStoppingPoint('Card opacity')}
        onKeyDown={(event) => {
          if (!opacityKeys.includes(event.key)) return
          event.stopPropagation()
          if (!event.repeat) editor.markHistoryStoppingPoint('Card opacity')
        }}
        onChange={(event) => {
          const value = event.currentTarget.valueAsNumber / 100
          editor.run(() => {
            if (editor.isIn('select')) editor.setOpacityForSelectedShapes(value)
            editor.setOpacityForNextShapes(value)
          })
        }} />
      <output aria-hidden="true">{opacity.type === 'mixed' ? '—' : percentage + '%'}</output>
    </label>
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

  const needsGeometryOptions = styles.get(GeoShapeGeoStyle) || styles.get(ArrowShapeArrowheadStartStyle) ||
    styles.get(ArrowShapeArrowheadEndStyle) || styles.get(DefaultHorizontalAlignStyle) || styles.get(DefaultVerticalAlignStyle)

  return (
    <div className="card-style-dock" role="group" aria-label="Card 样式">
      {styles.get(DefaultColorStyle) && (
        <CardColorPalette selected={styles.getAsKnownValue(DefaultColorStyle)} onSelect={(value, selectionOnly) => {
          editor.markHistoryStoppingPoint('Card color')
          editor.run(() => {
            if (editor.isIn('select')) editor.setStyleForSelectedShapes(DefaultColorStyle, value)
            if (!(selectionOnly && editor.getSelectedShapeIds().length)) editor.setStyleForNextShapes(DefaultColorStyle, value)
          })
        }} />
      )}
      <InlineStyle style={DefaultSizeStyle} styles={styles} label={isText ? '字号' : '粗细'}
        labels={isText ? { s: '小', m: '中', l: '大', xl: '特大' } : sizeLabels}
        preview={(size) => <LinePreview weight={{ s: 1, m: 2.2, l: 3.8, xl: 5.4 }[size]} />} />
      <InlineStyle style={DefaultDashStyle} styles={styles} label="线型" labels={dashLabels} preview={(dash) => <LinePreview dash={dash} />} />
      <InlineStyle style={DefaultFontStyle} styles={styles} label="字体" labels={fontLabels}
        preview={(font) => <TldrawUiButtonIcon icon={'font-' + font} />} />
      <InlineStyle style={DefaultFillStyle} styles={styles} label="填充" labels={fillLabels}
        preview={(fill) => <TldrawUiButtonIcon icon={'fill-' + fill} />} />
      <InlineStyle style={DefaultTextAlignStyle} styles={styles} label="文字对齐" labels={textAlignLabels}
        preview={(align) => <TldrawUiButtonIcon icon={{ start: 'text-align-left', middle: 'text-align-center', end: 'text-align-right' }[align]} />} />
      <InlineStyle style={ArrowShapeKindStyle} styles={styles} label="箭头路径" labels={{ arc: '曲线', elbow: '折线' }}
        preview={(kind) => <TldrawUiButtonIcon icon={'arrow-' + kind} />} />
      <InlineStyle style={LineShapeSplineStyle} styles={styles} label="路径" labels={{ line: '直线', cubic: '曲线' }}
        preview={(kind) => <TldrawUiButtonIcon icon={kind === 'line' ? 'spline-line' : 'spline-cubic'} />} />
      <OpacityControl />
      {needsGeometryOptions && (
        <TldrawUiPopover id="card-geometry-options">
          <TldrawUiPopoverTrigger>
            <button type="button" className="card-style-option" aria-label="形状细节" title="形状细节" {...triggerEvents}>
              <TldrawUiButtonIcon icon="dots-horizontal" small />
            </button>
          </TldrawUiPopoverTrigger>
          <TldrawUiPopoverContent side="top" align="end" alignOffset={alignOffset} collisionPadding={8}>
            <DefaultStylePanel styles={styles} isMobile>
              <StylePanelSection><StylePanelLabelAlignPicker /><StylePanelGeoShapePicker /><StylePanelArrowheadPicker /></StylePanelSection>
            </DefaultStylePanel>
          </TldrawUiPopoverContent>
        </TldrawUiPopover>
      )}
    </div>
  )
}
