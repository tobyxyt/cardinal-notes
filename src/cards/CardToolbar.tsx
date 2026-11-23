import { useRef } from 'react'
import {
  GeoShapeGeoStyle, TldrawUiButtonIcon, TldrawUiDropdownMenuContent, TldrawUiDropdownMenuRoot,
  TldrawUiDropdownMenuTrigger, TldrawUiMenuActionItem, TldrawUiMenuContextProvider, TldrawUiMenuGroup,
  TldrawUiToolbar, TldrawUiToolbarButton, ToggleToolLockItem, ToolbarItem, unwrapLabel, useEditor,
  usePassThroughWheelEvents, useReadonly, useTools, useTranslation, useValue,
} from 'tldraw'
import CardStyleDock from './CardStyleDock'

const primaryTools = ['select', 'hand', 'draw', 'eraser', 'text', 'highlight']
const secondaryTools = ['rectangle', 'ellipse', 'arrow', 'line', 'note', 'asset', 'frame']

function MoreTools() {
  const editor = useEditor()
  const tools = useTools()
  const msg = useTranslation()
  const readonly = useReadonly()
  const activeId = useValue('active Card tool', () => {
    const toolId = editor.getCurrentToolId()
    return toolId === 'geo' ? editor.getStyleForNextShape(GeoShapeGeoStyle) : toolId
  }, [editor])
  const items = Object.values(tools).filter(({ id, readonlyOk }) =>
    !primaryTools.includes(id) && (!readonly || readonlyOk))
  const active = items.find(({ id }) => id === activeId)
  const activeLabel = active && unwrapLabel(active.label, 'toolbar')

  return (
    <TldrawUiDropdownMenuRoot id="card-more-tools">
      <TldrawUiDropdownMenuTrigger>
        <TldrawUiToolbarButton type="icon" title={activeLabel ? '更多工具 · ' + msg(activeLabel) : '更多工具'}
          isActive={Boolean(active)}>
          <TldrawUiButtonIcon icon={active?.icon ?? 'dots-horizontal'} />
        </TldrawUiToolbarButton>
      </TldrawUiDropdownMenuTrigger>
      <TldrawUiDropdownMenuContent className="card-more-tools" side="top" align="end" alignOffset={0}>
        <TldrawUiMenuContextProvider type="menu" sourceId="toolbar">
          <TldrawUiMenuGroup id="extra-tools">
            {secondaryTools.filter((id) => items.some((item) => item.id === id)).map((id) => <ToolbarItem key={id} tool={id} />)}
          </TldrawUiMenuGroup>
          <TldrawUiMenuGroup id="other-tools">
            {items.filter(({ id }) => !secondaryTools.includes(id)).map(({ id }) => <ToolbarItem key={id} tool={id} />)}
          </TldrawUiMenuGroup>
          {!readonly && <TldrawUiMenuGroup id="tool-options">
            <ToggleToolLockItem />
          </TldrawUiMenuGroup>}
        </TldrawUiMenuContextProvider>
      </TldrawUiDropdownMenuContent>
    </TldrawUiDropdownMenuRoot>
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
