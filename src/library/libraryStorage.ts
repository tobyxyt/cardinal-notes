import { datasetKey } from '../dataset'
import { listPdfs } from '../pdf/pdfStorage'

export type Folder = { id: string; name: string; parentId: string | null }
export type LibraryData = { folders: Folder[]; placements: { pdfId: string; folderId: string }[] }

export const EMPTY_LIBRARY: LibraryData = { folders: [], placements: [] }
export const LIBRARY_KEY = datasetKey('library')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function libraryKey(dataset: string) {
  return datasetKey('library', dataset)
}

export function validateLibrary(value: unknown, pdfIds?: ReadonlySet<string>): LibraryData {
  const data = value as LibraryData | null
  const invalid = new Error('Library 包含无效的文件夹或 PDF 位置。')
  if (!data || !Array.isArray(data.folders) || !Array.isArray(data.placements)) throw invalid
  const folders = new Map<string, Folder>()
  for (const folder of data.folders) {
    if (!folder || typeof folder.id !== 'string' || !UUID.test(folder.id) || folders.has(folder.id) ||
        typeof folder.name !== 'string' || !folder.name.trim() ||
        (folder.parentId !== null && typeof folder.parentId !== 'string')) throw invalid
    folders.set(folder.id, folder)
  }
  const checked = new Set<string>()
  for (const { id } of data.folders) {
    const path = new Set<string>()
    let parent: string | null = id
    while (parent !== null && !checked.has(parent)) {
      const folder = folders.get(parent)
      if (!folder || path.has(parent)) throw new Error('Library 包含缺失的父文件夹或循环嵌套。')
      path.add(parent)
      parent = folder.parentId
    }
    for (const item of path) checked.add(item)
  }
  const placed = new Set<string>()
  for (const entry of data.placements) {
    if (!entry || typeof entry.pdfId !== 'string' || !UUID.test(entry.pdfId) || placed.has(entry.pdfId) ||
        !folders.has(entry.folderId) || (pdfIds && !pdfIds.has(entry.pdfId))) throw invalid
    placed.add(entry.pdfId)
  }
  return data
}

export function readLibrary(): LibraryData {
  const saved = localStorage.getItem(LIBRARY_KEY)
  return saved === null ? EMPTY_LIBRARY : validateLibrary(JSON.parse(saved))
}

export function updateLibrary(change: (latest: LibraryData) => LibraryData) {
  return navigator.locks.request(LIBRARY_KEY, async () => {
    const pdfIds = new Set((await listPdfs()).map(({ id }) => id))
    const data = validateLibrary(change(readLibrary()), pdfIds)
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(data))
    return data
  })
}

export function folderContains(folders: ReadonlyMap<string, Folder>, ancestorId: string, folderId: string | null) {
  for (let id = folderId; id !== null; id = folders.get(id)?.parentId ?? null) {
    if (id === ancestorId) return true
  }
  return false
}

function requireFolder(data: LibraryData, id: string) {
  const folder = data.folders.find((item) => item.id === id)
  if (!folder) throw new Error('该文件夹已不存在。')
  return folder
}

export function nameFolder(data: LibraryData, name: string, parentId: string | null, id?: string): LibraryData {
  const title = name.trim()
  if (!title) throw new Error('请输入文件夹名称。')
  if (id) {
    requireFolder(data, id)
    return { ...data, folders: data.folders.map((folder) => folder.id === id ? { ...folder, name: title } : folder) }
  }
  if (parentId !== null) requireFolder(data, parentId)
  return { ...data, folders: [...data.folders, { id: crypto.randomUUID(), name: title, parentId }] }
}

export function moveFolder(data: LibraryData, id: string, parentId: string | null): LibraryData {
  requireFolder(data, id)
  if (parentId !== null) requireFolder(data, parentId)
  if (folderContains(new Map(data.folders.map((folder) => [folder.id, folder])), id, parentId)) {
    throw new Error('无法将文件夹移入自身或子文件夹。')
  }
  return { ...data, folders: data.folders.map((folder) => folder.id === id ? { ...folder, parentId } : folder) }
}

export function movePdf(data: LibraryData, pdfId: string, folderId: string | null): LibraryData {
  if (folderId !== null) requireFolder(data, folderId)
  const placements = data.placements.filter((item) => item.pdfId !== pdfId)
  if (folderId !== null) placements.push({ pdfId, folderId })
  return { ...data, placements }
}

export function removeFolder(data: LibraryData, id: string): LibraryData {
  const { parentId } = requireFolder(data, id)
  return {
    folders: data.folders.filter((folder) => folder.id !== id).map((folder) =>
      folder.parentId === id ? { ...folder, parentId } : folder),
    placements: data.placements.flatMap((item) => item.folderId !== id ? [item] :
      parentId === null ? [] : [{ ...item, folderId: parentId }]),
  }
}
