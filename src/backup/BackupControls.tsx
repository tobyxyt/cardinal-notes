import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { CARD_LIST_KEY } from '../cards/cardStorage'
import { verifySavedCanvas, waitForCanvasSaves, type LiveCanvas } from '../cards/canvasPersistence'
import WorkspaceIcon from '../WorkspaceIcon'
import { readActiveDataset, WORKSPACE_LOCK, workspaceDataset } from '../dataset'

const RESTORED = 'cardinal-notes:restore-completed'

type Props = {
  disabled: boolean
  captureCanvas: () => LiveCanvas | null | undefined
  setBusy: (busy: boolean) => void
  setPaused: (paused: boolean) => void
}

export default function BackupControls({ disabled, captureCanvas, setBusy, setPaused }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (sessionStorage.getItem(RESTORED)) {
      sessionStorage.removeItem(RESTORED)
      setMessage('备份恢复成功。')
    }
  }, [])

  async function run(file?: File) {
    setBusy(true)
    setMessage('')
    setError('')
    setProgress(file ? '正在检查备份…' : '正在等待画布保存…')
    let reloading = false

    try {
      const backup = await import('./workspaceBackup')
      const data = file ? await backup.readBackup(file) : null
      if (data && !window.confirm('恢复会替换当前的 Workspace、Card 和 PDF。确认继续吗？')) {
        setMessage('已取消恢复。')
        return
      }
      const live = captureCanvas()
      if (live === undefined) throw new Error('当前画布还未准备好，请稍后重试。')
      if (live) await verifySavedCanvas(live)

      flushSync(() => setPaused(true))
      await waitForCanvasSaves()
      await navigator.locks.request(WORKSPACE_LOCK, { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error('请关闭 Cardinal Notes 的其他标签页后重试。')
        if (readActiveDataset() !== workspaceDataset) throw new Error('当前数据已切换，请刷新后重试。')

        if (data) {
          setProgress('正在恢复备份…')
          await backup.restoreWorkspace(data)
          try {
            sessionStorage.setItem(RESTORED, '1')
          } catch {
            // The restore is committed even if the success notice cannot be stored.
          }
          reloading = true
          window.location.reload()
          return
        }

        setProgress('正在打包备份…')
        const zip = await navigator.locks.request(CARD_LIST_KEY, () => backup.exportWorkspace(live))
        const link = document.createElement('a')
        const url = URL.createObjectURL(zip)
        link.href = url
        link.download = `cardinal-notes-${new Date().toISOString().slice(0, 10)}.zip`
        document.body.append(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
        setMessage('备份已生成，下载已开始。')
      })
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : '请稍后重试。'
      setError(`${file ? '导入备份失败' : '导出备份失败'}。${detail}`)
    } finally {
      if (!reloading) {
        setPaused(false)
        setBusy(false)
        setProgress('')
      }
    }
  }

  return (
    <div className="backup-bar" aria-label="数据备份">
      <button type="button" className="tool-button more-button" aria-label="更多操作" title="更多操作"
        popoverTarget="workspace-actions" disabled={disabled || !!progress}>
        <WorkspaceIcon name="more" />
      </button>
      <div className="workspace-menu" id="workspace-actions" ref={menu} popover="auto" role="group" aria-label="备份操作">
        <button type="button" onClick={() => { menu.current?.hidePopover(); input.current?.click() }}>
          <WorkspaceIcon name="import" /> 导入备份
        </button>
        <button type="button" onClick={() => { menu.current?.hidePopover(); void run() }}>
          <WorkspaceIcon name="export" /> 导出备份
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        aria-label="选择 ZIP 备份"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void run(file)
        }}
      />
      {(progress || message || error) && (
        <div className="backup-feedback">
          <span role={error ? 'alert' : 'status'}>{error || progress || message}</span>
          {!progress && (
            <button type="button" className="tool-button" aria-label="关闭通知" title="关闭通知"
              onClick={() => { setMessage(''); setError('') }}>
              <WorkspaceIcon name="close" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
