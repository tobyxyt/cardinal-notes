import { useEffect, useState, type FormEvent } from 'react'
import WorkspaceIcon from '../WorkspaceIcon'
import type { Card } from '../cards/cardStorage'
import type { PdfRegionReference } from '../pdf/pdfRegion'
import type { PdfFile } from '../pdf/pdfStorage'
import {
  EMPTY_LIBRARY, LIBRARY_KEY, folderContains, moveFolder, movePdf, nameFolder, readLibrary,
  removeFolder, updateLibrary, type Folder, type LibraryData,
} from './libraryStorage'
import './library.css'

export type LibraryDocument = { kind: 'pdf' | 'card'; id: string }
type DocumentLabel = LibraryDocument & { title: string }
type FolderOption = Folder & { path: string }
type FolderForm = { id?: string; parentId: string | null; name: string }

function DocumentRow({
  document, linked, unknown, onOpen, onDelete, actions, path,
}: {
  document: DocumentLabel
  linked: DocumentLabel[]
  unknown: boolean
  onOpen: (document: LibraryDocument) => void
  onDelete: (document: DocumentLabel) => void
  actions?: React.ReactNode
  path?: string
}) {
  const pdf = document.kind === 'pdf'
  const relation = pdf ? '关联 Cards' : '关联 PDF'
  const count = unknown ? linked.length ? '至少 ' + linked.length : '待确认' : String(linked.length)
  return (
    <li className="library-document">
      <div className="library-row">
        <button type="button" className="library-title" title={document.title} onClick={() => onOpen(document)}>
          <WorkspaceIcon name={document.kind} />
          <span>{document.title}</span>
        </button>
        {path && <span className="library-path" title={path}>{path}</span>}
        {actions}
        <button type="button" className="tool-button" aria-label={'永久删除 ' + document.title} title="永久删除文档"
          onClick={() => onDelete(document)}><WorkspaceIcon name="trash" /></button>
      </div>
      <details className="library-relations">
        <summary>{relation}<span className="library-count">{count}</span></summary>
        {linked.length ? (
          <ul className="library-linked">
            {linked.map((item) => (
              <li key={item.id}>
                <button type="button" className="library-title" title={item.title} onClick={() => onOpen(item)}>
                  <WorkspaceIcon name={item.kind} /><span>{item.title}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p>{unknown ? '关联尚未确认。' : pdf ? '暂无关联 Card。' : '暂无关联 PDF。'}</p>}
      </details>
    </li>
  )
}

function FolderSelect({
  label, value, options, disabled, onChange,
}: {
  label: string
  value: string | null
  options: FolderOption[]
  disabled: boolean
  onChange: (id: string | null) => void
}) {
  return (
    <select className="library-select" aria-label={label} title={label} value={value ?? ''} disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value || null)}>
      <option value="">根目录</option>
      {options.map(({ id, path }) => <option key={id} value={id}>{path}</option>)}
    </select>
  )
}

export default function Library({
  files, cards, references, hasUnknownReferences, loading, importDisabled, importStatus, pdfErrors, onImport, onOpenDocument, onDeleteDocument,
}: {
  files: PdfFile[]
  cards: Card[]
  references: PdfRegionReference[]
  hasUnknownReferences: boolean
  loading: boolean
  importDisabled: boolean
  importStatus: string
  pdfErrors: string
  onImport: () => void
  onOpenDocument: (document: LibraryDocument) => void
  onDeleteDocument: (document: DocumentLabel) => void
}) {
  const [view, setView] = useState<'pdf' | 'card'>('pdf')
  const [search, setSearch] = useState({ pdf: '', card: '' })
  const [filter, setFilter] = useState('*')
  const [data, setData] = useState<LibraryData>(EMPTY_LIBRARY)
  const [collapsed, setCollapsed] = useState(new Set<string>())
  const [form, setForm] = useState<FolderForm | null>(null)
  const [error, setError] = useState('')
  const [writing, setWriting] = useState(false)
  const [storageReady, setStorageReady] = useState(false)
  const disabled = writing || !storageReady
  const unknown = hasUnknownReferences || loading

  useEffect(() => {
    function refresh() {
      try {
        setData(readLibrary())
        setStorageReady(true)
        setError('')
      } catch (cause) {
        setStorageReady(false)
        setError(cause instanceof Error ? cause.message : '无法读取 Library。')
      }
    }
    function onStorage(event: StorageEvent) {
      if (event.key === LIBRARY_KEY || event.key === null) refresh()
    }
    refresh()
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  async function change(update: (data: LibraryData) => LibraryData) {
    setWriting(true)
    setError('')
    try {
      setData(await updateLibrary(update))
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存 Library。')
      return false
    } finally {
      setWriting(false)
    }
  }

  const folderById = new Map(data.folders.map((folder) => [folder.id, folder]))
  const foldersByParent = new Map<string | null, Folder[]>()
  for (const folder of [...data.folders].sort((a, b) => a.name.localeCompare(b.name))) {
    const group = foldersByParent.get(folder.parentId) ?? []
    group.push(folder)
    foldersByParent.set(folder.parentId, group)
  }
  const options: FolderOption[] = []
  function collectFolderOptions(parentId: string | null, prefix: string) {
    for (const folder of foldersByParent.get(parentId) ?? []) {
      const path = prefix ? prefix + ' / ' + folder.name : folder.name
      options.push({ ...folder, path })
      collectFolderOptions(folder.id, path)
    }
  }
  collectFolderOptions(null, '')
  const paths = new Map(options.map(({ id, path }) => [id, path]))
  const positions = new Map(data.placements.map(({ pdfId, folderId }) => [pdfId, folderId]))
  const filesByFolder = new Map<string | null, PdfFile[]>()
  for (const file of files) {
    const parent = positions.get(file.id) ?? null
    const group = filesByFolder.get(parent) ?? []
    group.push(file)
    filesByFolder.set(parent, group)
  }

  const pdfsById = new Map(files.map((file) => [file.id, file]))
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  const linkedPdfs = new Map<string, Set<string>>()
  const linkedCards = new Map<string, Set<string>>()
  for (const { cardId, region: { pdfId } } of references) {
    if (!pdfsById.has(pdfId) || !cardsById.has(cardId)) continue
    const pdfIds = linkedPdfs.get(cardId) ?? new Set<string>()
    pdfIds.add(pdfId)
    linkedPdfs.set(cardId, pdfIds)
    const cardIds = linkedCards.get(pdfId) ?? new Set<string>()
    cardIds.add(cardId)
    linkedCards.set(pdfId, cardIds)
  }

  const query = search[view].trim().toLocaleLowerCase()
  const matches = (name: string) => name.toLocaleLowerCase().includes(query)
  const folderFilter = filter === '*' || filter === '' || folderById.has(filter) ? filter : '*'
  const cardResults = cards.filter(({ id, title }) =>
    matches(title) && (folderFilter === '*' || [...(linkedPdfs.get(id) ?? [])].some((pdfId) => {
      const parent = positions.get(pdfId) ?? null
      return folderFilter === '' ? parent === null : folderContains(folderById, folderFilter, parent)
    })),
  )

  function pdfRow(file: PdfFile, showPath = false) {
    const folderId = positions.get(file.id) ?? null
    return (
      <DocumentRow
        key={file.id}
        document={{ kind: 'pdf', id: file.id, title: file.name }}
        linked={[...(linkedCards.get(file.id) ?? [])].map((id) => ({ kind: 'card', id, title: cardsById.get(id)!.title }))}
        onOpen={onOpenDocument}
        onDelete={onDeleteDocument}
        unknown={unknown}
        path={showPath ? paths.get(folderId ?? '') ?? '根目录' : undefined}
        actions={<FolderSelect label={'移动 PDF ' + file.name} value={folderId} options={options}
          disabled={disabled || !options.length} onChange={(parent) => void change((latest) => movePdf(latest, file.id, parent))} />}
      />
    )
  }

  function toggleFolder(id: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function renderFolder(folder: Folder) {
    const expanded = !collapsed.has(folder.id)
    const children = foldersByParent.get(folder.id) ?? []
    const documents = filesByFolder.get(folder.id) ?? []
    return (
      <li key={folder.id} className="library-folder">
        <div className="library-row library-folder-row">
          <button type="button" className="library-title" aria-expanded={expanded} title={paths.get(folder.id)}
            onClick={() => toggleFolder(folder.id)}>
            <WorkspaceIcon name={expanded ? 'down' : 'right'} /><WorkspaceIcon name="folder" /><span>{folder.name}</span>
          </button>
          <div className="library-folder-tools">
            <button type="button" className="tool-button" title="新建子文件夹" aria-label={'新建子文件夹 ' + folder.name}
              disabled={disabled} onClick={() => setForm({ parentId: folder.id, name: '' })}><WorkspaceIcon name="plus" /></button>
            <button type="button" className="tool-button" title="重命名文件夹" aria-label={'重命名 ' + folder.name}
              disabled={disabled} onClick={() => setForm({ id: folder.id, parentId: folder.parentId, name: folder.name })}>
              <WorkspaceIcon name="rename" />
            </button>
            <button type="button" className="tool-button" title="删除文件夹" aria-label={'删除文件夹 ' + folder.name}
              disabled={disabled} onClick={() => {
                if (window.confirm('删除「' + folder.name + '」？其中的 PDF 和子文件夹将移到上一级。')) {
                  void change((latest) => removeFolder(latest, folder.id))
                }
              }}><WorkspaceIcon name="trash" /></button>
            <FolderSelect label={'移动文件夹 ' + folder.name} value={folder.parentId}
              options={options.filter(({ id }) => !folderContains(folderById, folder.id, id))} disabled={disabled}
              onChange={(parent) => void change((latest) => moveFolder(latest, folder.id, parent))} />
          </div>
        </div>
        {expanded && (children.length || documents.length
          ? <ul className="library-tree">{children.map(renderFolder)}{documents.map((file) => pdfRow(file))}</ul>
          : <p className="library-empty-folder">空文件夹</p>)}
      </li>
    )
  }

  async function saveFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form) return
    if (await change((latest) => nameFolder(latest, form.name, form.parentId, form.id))) {
      if (form.parentId && !form.id) setCollapsed((current) => {
        const next = new Set(current)
        next.delete(form.parentId!)
        return next
      })
      setForm(null)
    }
  }

  const pdfResults = query ? files.filter((file) => matches(file.name)) : filesByFolder.get(null) ?? []

  return (
    <main className="library-page" aria-labelledby="library-heading">
      <div className="library-content">
        <header className="library-heading">
          <h1 id="library-heading">Library</h1>
          <div className="layout-switch" role="group" aria-label="Library 浏览模式">
            <button type="button" className="layout-option" aria-pressed={view === 'pdf'}
              onClick={() => setView('pdf')}><WorkspaceIcon name="pdf" />PDF</button>
            <button type="button" className="layout-option" aria-pressed={view === 'card'}
              onClick={() => setView('card')}><WorkspaceIcon name="card" />All Cards</button>
          </div>
        </header>
        <div className="library-toolbar">
          <label className="library-search">
            <WorkspaceIcon name="search" />
            <input type="search" aria-label={view === 'pdf' ? '搜索 Library PDF' : '搜索 Card'}
              placeholder={view === 'pdf' ? '搜索 PDF' : '搜索 Card'} value={search[view]}
              onChange={(event) => {
                const value = event.currentTarget.value
                setSearch((current) => ({ ...current, [view]: value }))
              }} />
          </label>
          {view === 'pdf' ? (
            <div className="library-toolbar-actions">
              <button type="button" className="text-button" disabled={disabled}
                onClick={() => setForm({ parentId: null, name: '' })}><WorkspaceIcon name="folder" />新建文件夹</button>
              <button type="button" className="text-button primary-tool" disabled={importDisabled}
                onClick={onImport}><WorkspaceIcon name="import" />导入 PDF</button>
            </div>
          ) : (
            <select className="library-select library-filter" aria-label="按 PDF 文件夹筛选 Card"
              value={folderFilter} onChange={(event) => setFilter(event.currentTarget.value)}>
              <option value="*">所有文件夹</option>
              <option value="">根目录</option>
              {options.map(({ id, path }) => <option key={id} value={id}>{path}</option>)}
            </select>
          )}
        </div>
        {error && <p className="library-warning" role="alert">{error}</p>}
        {view === 'pdf' && pdfErrors && <p className="library-warning" role="alert">{pdfErrors}</p>}
        {view === 'pdf' && importStatus && <p className="library-warning" role="status">{importStatus}</p>}
        {unknown && <p className="library-warning" role="status">部分 PDF 引用尚未确认，关联结果可能不完整。</p>}
        {view === 'pdf' && form && (
          <form className="library-form" onSubmit={(event) => void saveFolder(event)}>
            <label>
              {form.id ? '重命名文件夹' : '新建文件夹'}
              <input key={form.id ?? form.parentId ?? 'root'} autoFocus required aria-label="文件夹名称"
                value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} />
            </label>
            <button type="submit" className="text-button primary-tool" disabled={disabled}>保存</button>
            <button type="button" className="text-button" onClick={() => setForm(null)}>取消</button>
          </form>
        )}
        {view === 'pdf' ? (
          <section aria-label="PDF 文件树">
            <ul className="library-tree">
              {!query && (foldersByParent.get(null) ?? []).map(renderFolder)}
              {pdfResults.map((file) => pdfRow(file, Boolean(query)))}
            </ul>
            {!pdfResults.length && (query || !data.folders.length) && (
              <p className="library-empty">{loading ? '正在加载 PDF…' : query ? '没有匹配的 PDF。' : '导入 PDF 后，可在这里整理文件。'}</p>
            )}
          </section>
        ) : (
          <section aria-label="All Cards">
            <ul className="library-tree">
              {cardResults.map(({ id, title }) => (
                <DocumentRow key={id} document={{ kind: 'card', id, title }} onOpen={onOpenDocument} onDelete={onDeleteDocument} unknown={unknown}
                  linked={[...(linkedPdfs.get(id) ?? [])].map((pdfId) => ({ kind: 'pdf', id: pdfId, title: pdfsById.get(pdfId)!.name }))} />
              ))}
            </ul>
            {!cardResults.length && <p className="library-empty">{unknown && folderFilter !== '*'
              ? '正在确认此文件夹中的关联。' : '没有匹配的 Card。'}</p>}
          </section>
        )}
      </div>
    </main>
  )
}
