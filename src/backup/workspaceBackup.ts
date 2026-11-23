import { BlobReader, BlobWriter, TextReader, ZipReader, ZipWriter, type FileEntry } from '@zip.js/zip.js'
import { createTLStore, defaultAssetUtils, defaultBindingUtils, defaultShapeUtils } from 'tldraw'
import { loadCards, type CardListState } from '../cards/cardStorage'
import { PdfRegionShapeUtil } from '../cards/PdfRegionShape'
import { ACTIVE_DATASET_KEY, datasetKey, readActiveDataset, workspaceDataset } from '../dataset'
import { openPdf, pdfHash } from '../pdf/pdfDocument'
import { listPdfs, readActivePdfId, readPdf, removeStagedPdfs, writeRestoredPdfs, type PdfFile } from '../pdf/pdfStorage'
import { matchesLiveCanvas, readCanvas, removeStagedCanvas, writeCanvas, type CanvasData, type LiveCanvas } from '../cards/canvasPersistence'

import { EMPTY_LIBRARY, LIBRARY_KEY, libraryKey, readLibrary, validateLibrary, type LibraryData } from '../library/libraryStorage'

const FORMAT = 'cardinal-notes-backup'
const VERSION = 2
const TLDRAW_VERSION = '5.6.2'
const LIMIT = 512 * 1024 * 1024
const JSON_LIMIT = 32 * 1024 * 1024
const MAX_ENTRIES = 10_000
const MANIFEST = 'backup.json'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Manifest = {
  format: typeof FORMAT
  version: number
  tldrawVersion: string
  activeCardId: string
  activePdfId: string | null
  cards: { id: string; title: string; canvas: boolean }[]
  pdfs: PdfFile[]
  library: LibraryData
}

type AssetEntry = { id: string; type: string; name: string; lastModified: number }
type CanvasEntry = Omit<CanvasData, 'assets'> & { assets: AssetEntry[] }
type ValidatedBackup = {
  manifest: Manifest
  canvases: Map<string, CanvasData>
  pdfs: { file: PdfFile; blob: Blob }[]
}

const cardPath = (id: string) => `cards/${id}.json`
const pdfPath = (id: string) => `pdfs/${id}.pdf`
const assetPath = (cardId: string, index: number) => `assets/${cardId}/${index}.bin`

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function checkManifest(value: unknown): Manifest {
  const manifest = value as Manifest | null
  check(manifest?.format === FORMAT, '这不是 Cardinal Notes 备份。')
  check((manifest.version === 1 || manifest.version === VERSION) && manifest.tldrawVersion === TLDRAW_VERSION, '备份格式版本不兼容。')
  check(Array.isArray(manifest.cards) && manifest.cards.length > 0 && Array.isArray(manifest.pdfs), '备份缺少 Card 或 PDF 清单。')

  const cards = new Set<string>()
  for (const card of manifest.cards) {
    check(card && typeof card.id === 'string' && UUID.test(card.id) && !cards.has(card.id) &&
      typeof card.title === 'string' && card.title.trim() && typeof card.canvas === 'boolean', 'Card 清单无效或存在重复 ID。')
    cards.add(card.id)
  }
  check(cards.has(manifest.activeCardId), '当前 Card 不在备份清单中。')

  const pdfIds = new Set<string>()
  const hashes = new Set<string>()
  for (const file of manifest.pdfs) {
    check(file && typeof file.id === 'string' && UUID.test(file.id) && !pdfIds.has(file.id) &&
      typeof file.name === 'string' && file.name && typeof file.hash === 'string' &&
      /^[a-f0-9]{64}$/.test(file.hash) && !hashes.has(file.hash), 'PDF 清单无效、ID 重复或文件内容重复。')
    pdfIds.add(file.id)
    hashes.add(file.hash)
  }
  check(manifest.activePdfId === null || pdfIds.has(manifest.activePdfId), '当前 PDF 不在备份清单中。')
  const library = manifest.version === 1 ? EMPTY_LIBRARY : validateLibrary(manifest.library, pdfIds)
  return { ...manifest, library }
}

async function verifyPdf(file: PdfFile, blob: Blob) {
  const bytes = await blob.arrayBuffer()
  check(bytes.byteLength && await pdfHash(bytes) === file.hash, `PDF 内容不完整或校验失败：${file.name}`)
  const task = openPdf(bytes)
  try {
    const pdf = await task.promise
    await pdf.getPage(1)
    return pdf.numPages
  } catch {
    throw new Error(`备份中的 PDF 无法读取：${file.name}`)
  } finally {
    await task.destroy().catch(() => undefined)
  }
}

function validateShapeLinks(canvas: CanvasData, message: string) {
  const records = new Map(canvas.records.map((record) => [record.id as string, record]))
  const rooted = new Set<string>()
  for (const record of canvas.records) {
    if (record.typeName === 'binding') {
      check(records.get(record.fromId)?.typeName === 'shape' && records.get(record.toId)?.typeName === 'shape', message)
    }
    if (record.typeName !== 'shape' || rooted.has(record.id)) continue

    const chain = new Set<string>()
    let parent = record
    while (!rooted.has(parent.id)) {
      check(!chain.has(parent.id), message)
      chain.add(parent.id)
      const next = records.get(parent.parentId)
      check(next && (next.typeName === 'shape' || next.typeName === 'page'), message)
      if (next.typeName === 'page') break
      parent = next
    }
    for (const id of chain) rooted.add(id)
  }
}

function verifyCanvas(canvas: CanvasData, title: string, pages: Map<string, number>) {
  const invalid = `画布数据无效：${title}`
  check(Array.isArray(canvas.records) && Array.isArray(canvas.sessions), invalid)
  const ids = new Set<string>()
  for (const record of canvas.records) {
    check(record && typeof record.id === 'string' && !ids.has(record.id), invalid)
    ids.add(record.id)
  }
  for (const [id, blob] of canvas.assets) {
    check(id.startsWith('asset:') && blob instanceof Blob && blob.size > 0, `画布资源缺失或无效：${title}`)
  }
  const sessionIds = new Set<string>()
  for (const row of canvas.sessions) {
    check(row && typeof row.id === 'string' && !sessionIds.has(row.id) && Number.isFinite(row.updatedAt) &&
      row.snapshot && Number.isInteger(row.snapshot.version), `画布会话状态无效：${title}`)
    const { currentPageId, pageStates } = row.snapshot
    const stateValid = (page: NonNullable<typeof pageStates>[number]) => page &&
      typeof page.pageId === 'string' && page.pageId.startsWith('page:') &&
      (page.camera === undefined || (page.camera && Number.isFinite(page.camera.x) &&
        Number.isFinite(page.camera.y) && Number.isFinite(page.camera.z) && page.camera.z > 0)) &&
      (page.selectedShapeIds === undefined || (Array.isArray(page.selectedShapeIds) &&
        page.selectedShapeIds.every((id) => typeof id === 'string' && id.startsWith('shape:'))))
    check((currentPageId === undefined || (typeof currentPageId === 'string' && currentPageId.startsWith('page:'))) &&
      (pageStates === undefined || (Array.isArray(pageStates) && pageStates.every(stateValid))),
      `画布会话状态无效：${title}`)
    sessionIds.add(row.id)
  }
  if (!canvas.records.length) {
    check(!canvas.sessions.length, invalid)
    return
  }
  check(canvas.schema && canvas.records.some((record) => record.typeName === 'page') &&
    canvas.records.some((record) => record.typeName === 'document'), invalid)
  validateShapeLinks(canvas, `画布存在断开的图形引用或循环分组：${title}`)
  const store = createTLStore({
    shapeUtils: [...defaultShapeUtils, PdfRegionShapeUtil],
    bindingUtils: defaultBindingUtils,
    assetUtils: defaultAssetUtils,
  })
  try {
    store.loadStoreSnapshot({
      schema: canvas.schema,
      store: Object.fromEntries(canvas.records.map((record) => [record.id, record])),
    })
    const records = store.serialize()
    check(Object.keys(records).length === canvas.records.length, invalid)
    for (const record of Object.values(records)) {
      if (record.typeName === 'asset' && (record.type === 'image' || record.type === 'video')) {
        const { src } = record.props
        check(src && (src.startsWith('asset:') ? canvas.assets.has(record.id) : /^data:(image|video)\//.test(src)),
          `画布图片或媒体缺少本地内容：${title}（${record.id}）`)
      }
      if (record.typeName !== 'shape') continue
      if ('assetId' in record.props && typeof record.props.assetId === 'string') {
        check(records[record.props.assetId]?.typeName === 'asset', `画布资源引用缺失：${title}（${record.props.assetId}）`)
      }
      if (record.type === 'pdf-region') {
        const { pdfId, pageNumber, xMin, yMin, xMax, yMax, rotation } = record.props
        check(pageNumber > 0 && pageNumber <= (pages.get(pdfId) ?? 0),
          `PDF 选区缺少源文件或页码：${title}（${pdfId}）`)
        check(xMax > xMin && yMax > yMin && [0, 90, 180, 270].includes(rotation), `PDF 选区坐标无效：${title}`)
      }
    }
  } finally {
    store.dispose()
  }
}

export async function exportWorkspace(live: LiveCanvas) {
  const state = loadCards()
  const pdfs = await listPdfs()
  const chosenPdf = readActivePdfId()
  const library = await navigator.locks.request(LIBRARY_KEY, readLibrary)
  const manifest: Manifest = {
    format: FORMAT,
    version: VERSION,
    tldrawVersion: TLDRAW_VERSION,
    activeCardId: state.activeId,
    activePdfId: pdfs.some(({ id }) => id === chosenPdf) ? chosenPdf : null,
    cards: state.items.map(({ id, title }) => ({ id, title, canvas: false })),
    pdfs,
    library,
  }
  const writer = new ZipWriter(new BlobWriter('application/zip'), { level: 0, useWebWorkers: false })
  let total = 0
  let count = 0

  function reserve(size: number) {
    total += size
    count += 1
    check(total <= LIMIT && count <= MAX_ENTRIES, '备份超过本版的文件大小或条目上限。')
  }

  async function addBlob(path: string, blob: Blob) {
    reserve(blob.size)
    await writer.add(path, new BlobReader(blob))
  }

  async function addJson(path: string, value: unknown) {
    const json = JSON.stringify(value)
    const reader = new TextReader(json)
    const size = new Blob([json]).size
    check(size <= JSON_LIMIT, '备份中的清单或画布记录过大。')
    reserve(size)
    await writer.add(path, reader)
  }

  try {
    const pages = new Map<string, number>()
    for (const file of pdfs) {
      const blob = await readPdf(file.id).catch(() => { throw new Error(`本地 PDF 文件缺失：${file.name}`) })
      check(total + blob.size <= LIMIT, '备份超过 512 MiB。')
      pages.set(file.id, await verifyPdf(file, blob))
      await addBlob(pdfPath(file.id), blob)
    }
    let checkedLive = false
    for (const [index, card] of state.items.entries()) {
      const data = await readCanvas(card.persistenceKey)
      if (card.persistenceKey === live.persistenceKey) {
        check(matchesLiveCanvas(data, live), '当前画布的最新修改尚未写入磁盘，导出已停止。')
        checkedLive = true
      }
      if (!data) continue
      verifyCanvas(data, card.title, pages)
      manifest.cards[index].canvas = true
      const { assets, ...canvas } = data
      const entries: AssetEntry[] = []
      for (const [id, blob] of assets) {
        entries.push({
          id, type: blob.type, name: blob instanceof File ? blob.name : id,
          lastModified: blob instanceof File ? blob.lastModified : 0,
        })
        await addBlob(assetPath(card.id, entries.length - 1), blob)
      }
      await addJson(cardPath(card.id), { ...canvas, assets: entries })
    }
    check(checkedLive, '当前 Card 已经改变，请重新导出。')
    checkManifest(manifest)
    await addJson(MANIFEST, manifest)
  } catch (error) {
    await writer.close().catch(() => undefined)
    throw error
  }
  const blob = await writer.close()
  check(blob.size <= LIMIT, '备份超过 512 MiB。')
  return blob
}

export async function readBackup(file: Blob): Promise<ValidatedBackup> {
  check(file.size > 0 && file.size <= LIMIT, '请选择不超过 512 MiB 的 ZIP 备份。')
  const reader = new ZipReader(new BlobReader(file), { checkCrc32: true, strictness: 'strict' })
  try {
    const files = await reader.getEntries({ strictness: 'strict' }).catch(() => { throw new Error('ZIP 无法读取或已损坏。') })
    check(files.length <= MAX_ENTRIES, '备份条目数超出上限。')
    const entries = new Map<string, FileEntry>()
    let total = 0
    for (const entry of files) {
      // The backup writer uses stored ZIP entries. Validate sizes before reading any payload.
      check(!entry.directory && !entries.has(entry.filename) && !entry.encrypted &&
        entry.compressionMethod === 0 && entry.uncompressedSize === entry.compressedSize &&
        Number.isSafeInteger(entry.uncompressedSize) && entry.uncompressedSize >= 0, '备份包含重复或不支持的 ZIP 条目。')
      total += entry.uncompressedSize
      check(total <= LIMIT && total <= file.size, '备份内容大小无效。')
      entries.set(entry.filename, entry)
    }

    async function read(path: string, max = LIMIT, type?: string) {
      const entry = entries.get(path)
      check(entry, `备份缺少必要文件：${path}`)
      check(entry.uncompressedSize <= max, `备份文件过大：${path}`)
      entries.delete(path)
      try {
        const blob = await entry.getData(new BlobWriter(type), { checkCrc32: true, useWebWorkers: false })
        check(blob.size === entry.uncompressedSize, '文件大小不符。')
        return blob
      } catch {
        throw new Error(`ZIP 校验失败或文件损坏：${path}`)
      }
    }

    async function readJson(path: string): Promise<unknown> {
      const blob = await read(path, JSON_LIMIT)
      try {
        return JSON.parse(await blob.text()) as unknown
      } catch {
        throw new Error(`备份 JSON 无效：${path}`)
      }
    }

    const manifest = checkManifest(await readJson(MANIFEST))
    const pdfs: ValidatedBackup['pdfs'] = []
    const pages = new Map<string, number>()
    for (const file of manifest.pdfs) {
      const blob = await read(pdfPath(file.id), LIMIT, 'application/pdf')
      pages.set(file.id, await verifyPdf(file, blob))
      pdfs.push({ file, blob })
    }

    const canvases = new Map<string, CanvasData>()
    for (const card of manifest.cards) {
      if (!card.canvas) continue
      const canvas = await readJson(cardPath(card.id)) as CanvasEntry | null
      check(canvas && Array.isArray(canvas.assets), `画布备份缺少资源清单：${card.title}`)
      const assets = new Map<string, Blob>()
      for (const [index, entry] of canvas.assets.entries()) {
        check(entry && typeof entry.id === 'string' && entry.id.startsWith('asset:') && !assets.has(entry.id) &&
          typeof entry.name === 'string' && typeof entry.type === 'string' && Number.isFinite(entry.lastModified),
          `画布资源清单无效：${card.title}`)
        const blob = await read(assetPath(card.id, index), LIMIT, entry.type)
        assets.set(entry.id, new File([blob], entry.name, { type: entry.type, lastModified: entry.lastModified }))
      }
      const data = { ...canvas, assets }
      verifyCanvas(data, card.title, pages)
      canvases.set(card.id, data)
    }
    check(entries.size === 0, '备份包含未列入清单的文件。')
    return { manifest, canvases, pdfs }
  } finally {
    await reader.close().catch(() => undefined)
  }
}

export async function restoreWorkspace({ manifest, canvases, pdfs }: ValidatedBackup) {
  check(readActiveDataset() === workspaceDataset, '当前数据已在另一标签页切换，请刷新后重试。')
  const dataset = crypto.randomUUID()
  const cardsKey = datasetKey('cards', dataset)
  const pdfKey = datasetKey('active-pdf', dataset)
  const foldersKey = libraryKey(dataset)
  const cards: CardListState = {
    items: manifest.cards.map(({ id, title }) => ({ id, title, persistenceKey: datasetKey(`card:${id}`, dataset) })),
    activeId: manifest.activeCardId,
    pendingDeletes: [],
  }
  const created: string[] = []
  try {
    for (const card of cards.items) {
      const canvas = canvases.get(card.id)
      if (!canvas) continue
      created.push(card.persistenceKey)
      await writeCanvas(card.persistenceKey, canvas)
    }
    await writeRestoredPdfs(dataset, pdfs)
    localStorage.setItem(cardsKey, JSON.stringify(cards))
    if (manifest.activePdfId) localStorage.setItem(pdfKey, manifest.activePdfId)
    localStorage.setItem(foldersKey, JSON.stringify(manifest.library))
    // A single atomic pointer write activates both Card and PDF data on the next load.
    localStorage.setItem(ACTIVE_DATASET_KEY, dataset)
  } catch (error) {
    localStorage.removeItem(cardsKey)
    localStorage.removeItem(pdfKey)
    localStorage.removeItem(foldersKey)
    await Promise.all([...created.map(removeStagedCanvas), removeStagedPdfs(dataset)])
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      throw new Error('浏览器存储空间不足，恢复未切换，当前数据仍可使用。')
    }
    throw new Error('恢复写入失败，当前数据仍可使用。', { cause: error })
  }
}
