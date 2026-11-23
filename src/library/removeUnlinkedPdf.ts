import { CARD_LIST_KEY, loadCards } from '../cards/cardStorage'
import { readSettledReferences } from '../cards/pdfReferenceIndex'
import { deletePdf } from '../pdf/pdfStorage'
import { LIBRARY_KEY, movePdf, readLibrary } from './libraryStorage'
import { updateTab, updateWorkspaces } from '../workspace/workspaceStorage'

// Called with the exclusive workspace lease after all local editors have flushed.
export async function removeUnlinkedPdf(id: string) {
  await navigator.locks.request(CARD_LIST_KEY, async () => {
    for (const card of loadCards().items) {
      const references = await readSettledReferences(card.persistenceKey)
      if (references.some((region) => region.pdfId === id)) {
        throw new Error('此 PDF 仍被 Card 引用。请先移除相关选区。')
      }
    }
    await navigator.locks.request(LIBRARY_KEY, async () => {
      const original = localStorage.getItem(LIBRARY_KEY)
      const library = readLibrary()
      const placed = library.placements.some(({ pdfId }) => pdfId === id)
      if (placed) localStorage.setItem(LIBRARY_KEY, JSON.stringify(movePdf(library, id, null)))
      try {
        await deletePdf(id)
      } catch (cause) {
        if (placed && original !== null) localStorage.setItem(LIBRARY_KEY, original)
        throw cause
      }
    })
  })
  await updateWorkspaces((data) => ({
    ...data, items: data.items.map((session) => updateTab(session, 'pdf', id, false)),
  }))
}
