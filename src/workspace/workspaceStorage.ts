import { loadCards } from '../cards/cardStorage'
import { datasetKey } from '../dataset'
import { readActivePdfId } from '../pdf/pdfStorage'
import { loadLayout, type Layout } from '../WorkspaceLayout'

export const GENERAL_WORKSPACE = 'general'
export const WORKSPACES_KEY = datasetKey('workspaces')
export const READING_CHECKPOINT = datasetKey('reading-checkpoint')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type Tabs = { ids: string[]; activeId: string }
export type DocumentKind = 'pdf' | 'card'
export type PdfView = { page: number; scale: number | 'page-width'; left: number; top: number; at: number }
export type WorkspaceSession = {
  id: string
  name: string
  pdf: Tabs
  card: Tabs
  layout: Layout
  reading: Record<string, PdfView>
}
export type WorkspaceData = { activeId: string; items: WorkspaceSession[] }

const emptyTabs = (): Tabs => ({ ids: [], activeId: '' })

export function newWorkspace(id: string, name: string): WorkspaceSession {
  return { id, name, pdf: emptyTabs(), card: emptyTabs(), layout: { mode: 'split', pdfWidth: 50 }, reading: {} }
}

export function seedWorkspaces(card: Tabs, pdfId: string | null, layout?: Layout): WorkspaceData {
  const general = newWorkspace(GENERAL_WORKSPACE, 'General')
  general.card = card
  if (pdfId) general.pdf = { ids: [pdfId], activeId: pdfId }
  if (layout) general.layout = layout
  return { activeId: general.id, items: [general] }
}

export function openTab(tabs: Tabs, id: string): Tabs {
  if (tabs.activeId === id) return tabs
  return { ids: tabs.ids.includes(id) ? tabs.ids : [...tabs.ids, id], activeId: id }
}

export function closeTab(tabs: Tabs, id: string): Tabs {
  const index = tabs.ids.indexOf(id)
  if (index < 0) return tabs
  const ids = tabs.ids.filter((item) => item !== id)
  return { ids, activeId: tabs.activeId === id ? ids[Math.min(index, ids.length - 1)] ?? '' : tabs.activeId }
}

export function updateTab(session: WorkspaceSession, kind: DocumentKind, id: string, open: boolean) {
  const tabs = open ? openTab(session[kind], id) : closeTab(session[kind], id)
  if (tabs === session[kind]) return session
  if (open || kind === 'card') return { ...session, [kind]: tabs }
  const reading = { ...session.reading }
  delete reading[id]
  return { ...session, pdf: tabs, reading }
}

export function clearTabs(session: WorkspaceSession): WorkspaceSession {
  return { ...session, pdf: emptyTabs(), card: emptyTabs(), reading: {} }
}

export function changeSession(data: WorkspaceData, id: string, change: (session: WorkspaceSession) => WorkspaceSession) {
  return { ...data, items: data.items.map((session) => session.id === id ? change(session) : session) }
}

export function pruneDocuments(data: WorkspaceData, kind: DocumentKind, available: ReadonlySet<string>) {
  return { ...data, items: data.items.map((session) =>
    session[kind].ids.reduce((current, id) => available.has(id) ? current : updateTab(current, kind, id, false), session),
  ) }
}

function validView(value: unknown): value is PdfView {
  const view = value as PdfView
  return !!view && Number.isSafeInteger(view.page) && view.page > 0 &&
    (view.scale === 'page-width' || (Number.isFinite(view.scale) && view.scale > 0 && view.scale <= 100)) &&
    Number.isFinite(view.left) && Number.isFinite(view.top) && Number.isFinite(view.at) && view.at >= 0
}

export function saveView(session: WorkspaceSession, id: string, view: PdfView): WorkspaceSession {
  const previous = session.reading[id]
  if (!session.pdf.ids.includes(id) || !validView(view) || (previous && (previous.at > view.at ||
      (previous.page === view.page && previous.scale === view.scale && previous.left === view.left && previous.top === view.top)))) {
    return session
  }
  return { ...session, reading: { ...session.reading, [id]: view } }
}

export function validateWorkspaces(value: unknown): WorkspaceData {
  const data = value as WorkspaceData
  const bad = new Error('工作区或会话数据无效。')
  if (!data || !Array.isArray(data.items)) throw bad
  const seen = new Set<string>()
  for (const session of data.items) {
    if (!session || typeof session.id !== 'string' || (session.id !== GENERAL_WORKSPACE && !UUID.test(session.id)) ||
        seen.has(session.id) || typeof session.name !== 'string' || !session.name.trim() ||
        !session.layout || !['pdf', 'split', 'card'].includes(session.layout.mode) ||
        !Number.isFinite(session.layout.pdfWidth) || session.layout.pdfWidth < 15 || session.layout.pdfWidth > 85) throw bad
    seen.add(session.id)
    for (const tabs of [session.pdf, session.card]) {
      if (!tabs || !Array.isArray(tabs.ids) || tabs.ids.some((id) => typeof id !== 'string' || !UUID.test(id)) ||
          new Set(tabs.ids).size !== tabs.ids.length ||
          (tabs.ids.length ? !tabs.ids.includes(tabs.activeId) : tabs.activeId !== '')) throw bad
    }
    if (!session.reading || typeof session.reading !== 'object' || Array.isArray(session.reading) ||
        Object.entries(session.reading).some(([id, view]) => !session.pdf.ids.includes(id) || !validView(view))) throw bad
  }
  if (!seen.has(GENERAL_WORKSPACE) || !seen.has(data.activeId)) throw bad
  return data
}

export function readWorkspaces(): WorkspaceData {
  const saved = localStorage.getItem(WORKSPACES_KEY)
  if (saved !== null) return validateWorkspaces(JSON.parse(saved))
  return readLegacyWorkspace()
}

export function readLegacyWorkspace() {
  const cards = loadCards()
  const ids = cards.items.map(({ id }) => id)
  return seedWorkspaces({ ids, activeId: ids.includes(cards.activeId) ? cards.activeId : ids[0] ?? '' },
    readActivePdfId(), loadLayout())
}

export function updateWorkspaces(change: (data: WorkspaceData) => WorkspaceData | Promise<WorkspaceData>) {
  return navigator.locks.request(WORKSPACES_KEY, async () => {
    const data = validateWorkspaces(await change(readWorkspaces()))
    const encoded = JSON.stringify(data)
    if (encoded !== localStorage.getItem(WORKSPACES_KEY)) localStorage.setItem(WORKSPACES_KEY, encoded)
    return data
  })
}

export type ReadingCheckpoint = { workspaceId: string; pdfId: string; view: PdfView }

export function readCheckpoint(): ReadingCheckpoint | null {
  try {
    const pending = JSON.parse(sessionStorage.getItem(READING_CHECKPOINT) ?? 'null') as ReadingCheckpoint | null
    return pending && typeof pending.workspaceId === 'string' && typeof pending.pdfId === 'string' && validView(pending.view)
      ? pending : null
  } catch {
    return null
  }
}
