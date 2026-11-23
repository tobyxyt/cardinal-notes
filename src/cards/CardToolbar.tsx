import { useRef } from 'react'
import {
  GeoShapeGeoStyle, TldrawUiButton, TldrawUiButtonIcon, TldrawUiDropdownMenuContent, TldrawUiDropdownMenuItem, TldrawUiDropdownMenuRoot,
  TldrawUiDropdownMenuTrigger, TldrawUiMenuActionItem, TldrawUiMenuContextProvider, TldrawUiMenuGroup,
  TldrawUiToolbar, TldrawUiToolbarButton, ToggleToolLockItem, ToolbarItem, unwrapLabel, useEditor,
  usePassThroughWheelEvents, useReadonly, useTools, useTranslation, useValue,
} from 'tldraw'
import CardStyleDock from './CardStyleDock'
import { useCardPopupAlignment } from './useCardPopupAlignment'

const primaryTools = ['select', 'hand', 'draw', 'eraser', 'text', 'highlight', 'rectangle', 'ellipse', 'arrow']
const secondaryTools = ['line', 'note', 'asset', 'frame']

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
  const ordered = [...items.filter(({ id }) => secondaryTools.includes(id)), ...items.filter(({ id }) => !secondaryTools.includes(id))]
  const active = items.find(({ id }) => id === activeId)
  const activeLabel = active && unwrapLabel(active.label, 'toolbar')

  return (
    <TldrawUiDropdownMenuRoot id="card-more-tools">
      <TldrawUiDropdownMenuTrigger>
        <TldrawUiToolbarButton type="icon" title={activeLabel ? '更多工具 · ' + msg(activeLabel) : '更多工具'}
          isActive={Boolean(active)} {...triggerEvents}>
          <TldrawUiButtonIcon icon={active?.icon ?? 'dots-horizontal'} />
        </TldrawUiToolbarButton>
      </TldrawUiDropdownMenuTrigger>
      <TldrawUiDropdownMenuContent className="card-more-tools" side="top" align="end" alignOffset={alignOffset}>
        <div className="card-more-grid">
          {ordered.map((tool) => {
            const label = unwrapLabel(tool.label, 'toolbar')
            const name = label ? msg(label) : tool.id
            return (
              <TldrawUiDropdownMenuItem key={tool.id}>
                <TldrawUiButton type="icon" className="card-extra-tool" aria-label={name} tooltip={name}
                  isActive={tool.id === activeId} data-testid={'toolbar.' + tool.id} onClick={() => tool.onSelect('toolbar')}>
                  {tool.icon && <TldrawUiButtonIcon icon={tool.icon} />}
                  <span className="card-extra-tool-label" aria-hidden="true">{name}</span>
                </TldrawUiButton>
              </TldrawUiDropdownMenuItem>
            )
          })}
        </div>
        {!readonly && (
          <TldrawUiMenuContextProvider type="menu" sourceId="toolbar">
            <TldrawUiMenuGroup id="tool-options"><ToggleToolLockItem /></TldrawUiMenuGroup>
          </TldrawUiMenuContextProvider>
        )}
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
