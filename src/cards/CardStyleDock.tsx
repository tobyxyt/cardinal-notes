import type { ReactNode } from 'react'
import {
  DefaultColorStyle, DefaultDashStyle, DefaultFillStyle, DefaultFontStyle, DefaultSizeStyle, DefaultStylePanel,
  StylePanelArrowheadPicker, StylePanelArrowKindPicker, StylePanelColorPicker, StylePanelDashPicker,
  StylePanelFillPicker, StylePanelFontPicker, StylePanelGeoShapePicker, StylePanelLabelAlignPicker,
  StylePanelOpacityPicker, StylePanelSection, StylePanelSizePicker, StylePanelSplinePicker, StylePanelTextAlignPicker,
  TldrawUiPopover, TldrawUiPopoverContent, TldrawUiPopoverTrigger,
  useEditor, useReadonly, useRelevantStyles, useValue, type ReadonlySharedStyleMap,
} from 'tldraw'

const noSelectionDefaults = [] as const

function StyleControl({ id, label, preview, styles, children }: {
  id: string
  label: string
  preview?: ReactNode
  styles: ReadonlySharedStyleMap
  children: ReactNode
}) {
  return (
    <TldrawUiPopover id={'card-style-' + id}>
      <TldrawUiPopoverTrigger>
        <button type="button" className="card-style-control">
          {preview}{label}
        </button>
      </TldrawUiPopoverTrigger>
      <TldrawUiPopoverContent side="top" collisionPadding={8}>
        <div className="card-style-picker" role="group" aria-label={label}>
          <DefaultStylePanel styles={styles} isMobile>
            <StylePanelSection>{children}</StylePanelSection>
          </DefaultStylePanel>
        </div>
      </TldrawUiPopoverContent>
    </TldrawUiPopover>
  )
}

export default function CardStyleDock() {
  const editor = useEditor()
  const readonly = useReadonly()
  // The native panel shows creation defaults with nothing selected. The dock only shows relevant styles.
  const styles = useRelevantStyles(noSelectionDefaults)
  const isText = useValue('Card text sizing', () =>
    editor.isIn('text') || (editor.isIn('select') && editor.getSelectedShapes().every(({ type }) => type === 'text')),
  [editor])
  const color = styles?.getAsKnownValue(DefaultColorStyle)
  const swatch = useValue('Card color preview', () =>
    color ? editor.getCurrentTheme().colors[editor.getColorMode()][color]?.solid : undefined,
  [editor, color])

  if (readonly || !styles) return null

  return (
    <div className="card-style-dock" role="group" aria-label="Card 样式">
      {styles.get(DefaultColorStyle) && (
        <StyleControl id="color" label="颜色" styles={styles}
          preview={<span className="card-style-swatch" aria-hidden="true" style={{ background: swatch }} />}>
          <StylePanelColorPicker />
        </StyleControl>
      )}
      {styles.get(DefaultSizeStyle) && (
        <StyleControl id="size" label={isText ? '字号' : '粗细'} styles={styles}>
          <StylePanelSizePicker />
        </StyleControl>
      )}
      {styles.get(DefaultFontStyle) && <StyleControl id="font" label="字体" styles={styles}><StylePanelFontPicker /></StyleControl>}
      {styles.get(DefaultDashStyle) && <StyleControl id="dash" label="线型" styles={styles}><StylePanelDashPicker /></StyleControl>}
      {styles.get(DefaultFillStyle) && <StyleControl id="fill" label="填充" styles={styles}><StylePanelFillPicker /></StyleControl>}
      <StyleControl id="other" label="更多样式" styles={styles}>
        <StylePanelOpacityPicker />
        <StylePanelTextAlignPicker />
        <StylePanelLabelAlignPicker />
        <StylePanelGeoShapePicker />
        <StylePanelArrowKindPicker />
        <StylePanelArrowheadPicker />
        <StylePanelSplinePicker />
      </StyleControl>
    </div>
  )
}
