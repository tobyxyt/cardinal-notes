import { useState, type SyntheticEvent } from 'react'
import { useEditor } from 'tldraw'

export function useCardPopupAlignment() {
  const editor = useEditor()
  const [alignOffset, setAlignOffset] = useState(0)

  function measure({ currentTarget }: SyntheticEvent<HTMLButtonElement>) {
    const container = editor.getContainer()
    const pane = container.getBoundingClientRect()
    const trigger = currentTarget.getBoundingClientRect()
    setAlignOffset(container.dir === 'rtl' ? pane.left + 8 - trigger.left : trigger.right - (pane.right - 8))
  }

  return { alignOffset, triggerEvents: { onPointerDownCapture: measure, onKeyDownCapture: measure, onClickCapture: measure } }
}
