import { useRef } from 'react'
import {
  GeoShapeGeoStyle, TldrawUiButtonIcon, TldrawUiMenuActionItem, TldrawUiMenuContextProvider,
  TldrawUiPopover, TldrawUiPopoverContent, TldrawUiPopoverTrigger, TldrawUiToolbar, TldrawUiToolbarButton,
  ToggleToolLockedButton, ToolbarItem, tlmenus, unwrapLabel, useEditor, usePassThroughWheelEvents,
  useReadonly, useTools, useTranslation, useValue,
} from 'tldraw'
import CardStyleDock from './CardStyleDock'
import { useCardPopupAlignment } from './useCardPopupAlignment'

const primaryTools = ['select', 'hand', 'draw', 'eraser', 'text', 'highlight', 'rectangle', 'ellipse', 'arrow']
// Match the SDK toolbar order for stock items, with additional registered tools at the end.
const overflowOrder = [
  'note', 'asset', 'triangle', 'diamond', 'hexagon', 'oval', 'rhombus', 'star', 'cloud',
  'heart', 'x-box', 'check-box', 'arrow-left', 'arrow-up', 'arrow-down', 'arrow-right', 'line', 'laser', 'frame',
]
const overflowId = 'card-more-tools'

function MoreTools() {
  const editor = useEditor()
  const tools = useTools()
  const msg = useTranslation()
  const readonly = useReadonly()
  const { alignOffset, triggerEvents } = useCardPopupAlignment()
  const activeId = useValue('active Card tool', () => {
    const toolId = editor.getCurrentToolId()
    return toolId === 'geo' ? editor.getStyleForNextShape(GeoShapeGeoStyle) : toolId
  }, [editor])
  const items = Object.values(tools).filter(({ id, readonlyOk }) =>
    !primaryTools.includes(id) && (!readonly || readonlyOk))
  const included = new Set(items.map(({ id }) => id))
  const ordered = [...overflowOrder.filter((id) => included.has(id)),
    ...items.filter(({ id }) => !overflowOrder.includes(id)).map(({ id }) => id)]
  const active = items.find(({ id }) => id === activeId)
  const activeLabel = active && unwrapLabel(active.label, 'toolbar')

  return (
    <TldrawUiPopover id={overflowId}>
      <TldrawUiPopoverTrigger>
        <TldrawUiToolbarButton type="icon" title={activeLabel ? '更多工具 · ' + msg(activeLabel) : '更多工具'}
          isActive={Boolean(active)} {...triggerEvents}>
          <TldrawUiButtonIcon icon={active?.icon ?? 'chevron-up'} />
        </TldrawUiToolbarButton>
      </TldrawUiPopoverTrigger>
      <TldrawUiPopoverContent side="top" align="end" alignOffset={alignOffset} collisionPadding={8}>
        <TldrawUiToolbar orientation="grid" label="更多工具" className="card-more-grid"
          onClick={() => tlmenus.deleteOpenMenu(overflowId, editor.contextId)}>
          <TldrawUiMenuContextProvider type="toolbar-overflow" sourceId="toolbar">
            {ordered.map((id) => <ToolbarItem key={id} tool={id} />)}
          </TldrawUiMenuContextProvider>
        </TldrawUiToolbar>
        {!readonly && <ToggleToolLockedButton activeToolId={activeId} />}
      </TldrawUiPopoverContent>
    </TldrawUiPopover>
  )
}

export default function CardToolbar() {
  const ref = useRef<HTMLDivElement>(null)
  usePassThroughWheelEvents(ref)

  return (
    <div className="card-tool-dock" ref={ref}>
      <CardStyleDock />
      <TldrawUiToolbar label="Card 工具" className="card-tool-bar" tooltipSide="top">
        <TldrawUiMenuContextProvider type="toolbar" sourceId="toolbar">
          {primaryTools.map((tool) => <ToolbarItem key={tool} tool={tool} />)}
        </TldrawUiMenuContextProvider>
        <TldrawUiMenuContextProvider type="small-icons" sourceId="toolbar">
          <TldrawUiMenuActionItem actionId="undo" />
          <TldrawUiMenuActionItem actionId="redo" />
        </TldrawUiMenuContextProvider>
        <MoreTools />
      </TldrawUiToolbar>
    </div>
  )
}
