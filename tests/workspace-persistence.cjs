const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { chromium, expect } = require('@playwright/test')

const target = path.resolve(__dirname, '..')
const tempRoot = fs.realpathSync(os.tmpdir())
const scratch = fs.mkdtempSync(path.join(tempRoot, 'cardinal-reference-fixtures-'))
const verifyLegacy = process.argv.includes('--legacy')
const oldDist = path.join(scratch, 'old', 'dist')
const newDist = path.join(target, 'dist')
const version = '0fc8bf9'
const cachePrefix = 'cardinal-notes:pdf-reference-index:v1:'
const marker = (page) => page.locator('.pdf-history-mark')
const timeout = { timeout: 12_000 }
const pdfButton = (page, name) => page.locator('.pdf-file-list').getByRole('button', { name: name + '.pdf', exact: true })
const pdfHandle = (page) => page.getByRole('button', { name: 'PDF 导航', exact: true })
const cardsHandle = (page) => page.getByRole('button', { name: 'Linked Cards', exact: true })
const pdfPanel = (page) => page.getByRole('region', { name: 'PDF 导航', exact: true })
const cardsPanel = (page) => page.getByRole('region', { name: 'Linked Cards', exact: true })

async function selectPdf(page, name) {
  if (await pdfButton(page, name).count()) {
    await pdfButton(page, name).click()
    return
  }
  await pdfHandle(page).click()
  await pdfPanel(page).getByRole('button', { name: new RegExp('^' + name + '[.]pdf') }).click()
  await pdfHandle(page).press('Escape')
}
const cardButton = (page, number) => page.getByRole('group', { name: 'Card 列表' })
  .getByRole('button', { name: 'Card ' + number, exact: true })

function buildOld() {
  const archive = path.join(scratch, 'baseline.zip')
  const old = path.join(scratch, 'old')
  fs.mkdirSync(old)
  execFileSync('git', ['archive', '--format=zip', '--output', archive, version], { cwd: target })
  execFileSync('tar', ['-xf', archive, '-C', old])
  fs.symlinkSync(path.join(target, 'node_modules'), path.join(old, 'node_modules'), 'junction')
  fs.symlinkSync(path.join(target, 'public'), path.join(old, 'public'), 'junction')
  execFileSync(process.execPath, [path.join(target, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: old })
}

function makePdf(label, multiple = false) {
  const stream = '0.0 0.4 0.7 rg 40 650 110 110 re f\nBT /F1 18 Tf 100 600 Td (' + label + ') Tj ET'
  const parts = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    multiple ? '<< /Type /Pages /Count 2 /Kids [3 0 R 6 0 R] >>' : '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream',
  ]
  if (multiple) parts.push(parts[2])
  const offsets = []
  let pdf = '%PDF-1.4\n'
  for (const [index, part] of parts.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += (index + 1) + ' 0 obj\n' + part + '\nendobj\n'
  }
  const xref = Buffer.byteLength(pdf)
  pdf += 'xref\n0 ' + (parts.length + 1) + '\n0000000000 65535 f \n' + offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')
  return Buffer.from(pdf + 'trailer\n<< /Size ' + (parts.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n')
}

// The pinned SDK exposes its local client for diagnostics. Test fixtures use its live Store;
// application code must not depend on this diagnostic handle.
async function waitEditor(page, key) {
  await page.waitForFunction(expected => window.tlsync?.didLoad &&
    (!expected || window.tlsync.persistenceKey === expected) &&
    window.tlsync.store.allRecords().some(r => r.typeName === 'page'), key ?? null)
}

async function cardState(page) {
  return page.evaluate(() => {
    const dataset = localStorage.getItem('cardinal-notes:active-dataset')
    const prefix = dataset ? 'cardinal-notes:restore:' + dataset + ':' : 'cardinal-notes:'
    return JSON.parse(localStorage.getItem(prefix + 'cards'))
  })
}

async function getPdfs(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const dataset = localStorage.getItem('cardinal-notes:active-dataset')
    const req = indexedDB.open(dataset ? 'cardinal-notes:restore:' + dataset + ':pdfs' : 'cardinal-notes:pdfs')
    req.onsuccess = () => {
      const db = req.result
      const get = db.transaction('metadata').objectStore('metadata').getAll()
      get.onsuccess = () => { db.close(); resolve(Object.fromEntries(get.result.map(p => [p.name, p.id]))) }
      get.onerror = () => reject(get.error)
    }
    req.onerror = () => reject(req.error)
  }))
}

async function putShapes(page, pdf, shapes, addImage = false) {
  await page.evaluate(async ({ pdf, shapes, addImage }) => {
    const store = window.tlsync.store
    const parentId = store.allRecords().find(r => r.typeName === 'page').id
    const make = (id, type, x, index, props) => ({
      typeName: 'shape', id: 'shape:' + id, type, parentId, index,
      x, y: 75, rotation: 0, opacity: 1, isLocked: false, meta: {}, props,
    })
    const records = shapes.map(({ id, regionX, index, x }, i) =>
      make(id, 'pdf-region', x ?? 80 + i * 150, index, {
        w: 90, h: 90, pdfId: pdf, pageNumber: 1, rotation: 0,
        xMin: regionX, xMax: regionX + 65, yMin: 655, yMax: 720,
      }))
    if (addImage) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 16
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ff00bb'
      ctx.fillRect(0, 0, 16, 16)
      const blob = await new Promise(resolve => canvas.toBlob(resolve))
      const file = new File([blob], 'pixel.png', { type: 'image/png' })
      const asset = { id: 'asset:fixture', typeName: 'asset', type: 'image', meta: {},
        props: { name: file.name, w: 16, h: 16, src: null, mimeType: file.type, fileSize: file.size, isAnimated: false } }
      asset.props.src = (await store.props.assets.upload(asset, file)).src
      records.push(asset, make('photo', 'image', 380, 'a5',
        { w: 70, h: 70, assetId: asset.id, playing: true, url: '', crop: null, flipX: false, flipY: false, altText: '' }))
    }
    store.put(records)
  }, { pdf, shapes, addImage })
}

async function expectImage(page) {
  await expect.poll(() => page.evaluate(async () => {
    const asset = window.tlsync?.store.get('asset:fixture')
    if (!asset) return null
    const localUrl = await window.tlsync.store.props.assets.resolve(asset)
    if (!localUrl?.startsWith('blob:')) return null
    const bitmap = await createImageBitmap(await (await fetch(localUrl)).blob())
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    return [...ctx.getImageData(0, 0, 1, 1).data]
  }), timeout).toEqual([255, 0, 187, 255])
}

async function download(page, file) {
  const event = page.waitForEvent('download', timeout)
  const more = page.getByRole('button', { name: '更多操作', exact: true })
  if (await more.count()) await more.click()
  await page.getByRole('button', { name: '导出备份', exact: true }).click()
  await (await event).saveAs(file)
  await expect(page.getByText('备份已生成，下载已开始。')).toBeVisible()
  await waitEditor(page)
}

async function restore(page, file) {
  page.once('dialog', dialog => dialog.accept())
  await page.getByLabel('选择 ZIP 备份').setInputFiles(file)
  await expect(page.getByText('备份恢复成功。')).toBeVisible(timeout)
  await waitEditor(page)
}

async function expectCentered(locator, page) {
  await expect(locator).toBeVisible()
  const bounds = await locator.boundingBox()
  const width = await page.evaluate(() => document.documentElement.clientWidth)
  expect(Math.abs(bounds.x + bounds.width / 2 - width / 2)).toBeLessThan(1)
}

async function verifyLayout(page, browser, origin) {
  const workspace = page.locator('.split-workspace')
  const separator = page.getByRole('separator')
  const modeButton = (name) => page.getByRole('button', { name, exact: true })
  const ratio = (percent) => expect(separator).toHaveAttribute('aria-valuenow', String(percent))
  const mode = (value) => expect(workspace).toHaveAttribute('data-mode', value)
  await expect(page.locator('.pdfViewer .page').first()).toBeVisible(timeout)
  await page.evaluate(() => {
    window.layoutFixture = {
      editor: window.tldrawEditor ?? document.querySelector('.tl-container'),
      store: window.tlsync.store,
      viewer: document.querySelector('.pdfViewer'),
      page: document.querySelector('.pdfViewer .page'),
    }
    window.addEventListener('error', event => {
      if (event.message?.includes('ResizeObserver')) window.layoutError = event.message
    })
  })
  const stillMounted = () => expect(page.evaluate(() => {
    const original = window.layoutFixture
    return (window.tldrawEditor ?? document.querySelector('.tl-container')) === original.editor &&
      window.tlsync.store === original.store && document.querySelector('.pdfViewer') === original.viewer &&
      document.querySelector('.pdfViewer .page') === original.page
  })).resolves.toBe(true)

  async function dragTo(fraction) {
    const start = await separator.boundingBox()
    const area = await workspace.boundingBox()
    const y = start.y + start.height / 2
    await page.mouse.move(start.x + start.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(area.x + (area.width - start.width) * fraction + start.width / 2, y, { steps: 18 })
    await page.mouse.up()
  }

  await expect(page.getByRole('group', { name: '工作区模式', exact: true })).toHaveCount(0)
  await expectCentered(workspaceName(page, 'General'), page)
  await expectCentered(await manage(page), page)
  await workspaceName(page, 'General').press('Escape')
  await ratio(50)
  await expect(pdfHandle(page)).toBeVisible()
  await expect(cardsHandle(page)).toBeVisible()
  await expect(workspace.locator('.workspace-edge')).toHaveCount(0)
  await dragTo(0.65)
  await ratio(65)
  await dragTo(0.08)
  await mode('card')
  await expect(page.locator('#pdf-pane')).toHaveAttribute('inert', '')
  await expect(page.locator('#pdf-pane')).toBeHidden()
  await expect(pdfHandle(page)).toHaveCount(0)
  await expect(cardsHandle(page)).toBeVisible()
  await expect(workspace.locator('.workspace-edge')).toHaveCount(1)
  await stillMounted()
  const expandPdf = modeButton('展开 PDF，恢复双栏')
  await expect(expandPdf).toBeFocused()
  await expandPdf.press('Enter')
  await mode('split')
  await ratio(65)
  await dragTo(0.94)
  await mode('pdf')
  await expect(page.locator('#card-pane')).toHaveAttribute('inert', '')
  await expect(page.locator('#card-pane')).toBeHidden()
  await expect(cardsHandle(page)).toHaveCount(0)
  await expect(pdfHandle(page)).toBeVisible()
  await expect(workspace.locator('.workspace-edge')).toHaveCount(1)
  await stillMounted()
  await modeButton('展开 Card，恢复双栏').click()
  await ratio(65)
  await separator.dblclick()
  await ratio(50)
  await separator.press('ArrowRight')
  await ratio(55)
  await separator.press('End')
  await mode('pdf')
  await modeButton('展开 Card，恢复双栏').click()
  await separator.press('Home')
  await mode('card')
  await modeButton('插入 PDF 选区').click()
  await mode('split')
  await expect(page.getByRole('button', { name: '取消选区' })).toBeVisible()
  await page.getByRole('button', { name: '取消选区' }).click()
  await stillMounted()
  await separator.press('End')
  await mode('pdf')
  expect(await page.evaluate(() => window.layoutError)).toBeUndefined()
  await page.reload()
  await mode('pdf')
  await modeButton('展开 Card，恢复双栏').click()
  await ratio(55)
  await separator.press('Enter')
  await ratio(50)

  const touch = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true })
  try {
    const tablet = await touch.newPage()
    await tablet.goto(origin)
    await tablet.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: 'Workspaces', exact: true }).tap()
    await workspacesPage(tablet).getByRole('button', { name: 'General', exact: true }).tap()
    await expect(workspaceName(tablet, 'General')).toHaveAttribute('aria-current', 'page')
    await waitEditor(tablet)
    const divider = tablet.getByRole('separator')
    await expectCentered(workspaceName(tablet, 'General'), tablet)
    await expect(divider).toBeVisible()
    const box = await divider.boundingBox()
    const start = box.x + box.width / 2
    const y = box.y + box.height / 2
    const session = await touch.newCDPSession(tablet)
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 70, y }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(tablet.locator('.split-workspace')).toHaveAttribute('data-mode', 'card')
    const handle = tablet.getByRole('button', { name: '展开 PDF，恢复双栏' })
    await expect(handle).toBeVisible()
    const edge = await handle.boundingBox()
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{
      x: edge.x + edge.width / 2, y: edge.y + edge.height / 2,
    }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(divider).toHaveAttribute('aria-valuenow', '50')
    await tablet.setViewportSize({ width: 390, height: 844 })
    await expect(divider).toBeVisible()
    await expectCentered(workspaceName(tablet, 'General'), tablet)
    await expectCentered(await manage(tablet), tablet)
    await workspaceName(tablet, 'General').press('Escape')
    expect(await tablet.locator('.app-shell').evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(390)
  } finally {
    await touch.close()
  }
  console.log('Workspace snapping, expansion, keyboard, touch and persisted layout passed without remounting the editor or PDF.')
}

async function verifyNavigation(page, browser, origin) {
  const left = pdfHandle(page)
  const right = cardsHandle(page)
  const library = pdfPanel(page)
  const linked = cardsPanel(page)
  const workspace = page.locator('.split-workspace')
  const panes = () => workspace.locator('.workspace-pane').evaluateAll(nodes => nodes.map(node => node.clientWidth))
  const before = await panes()
  await left.hover()
  await expect(library).toBeVisible()
  await library.getByRole('searchbox', { name: '搜索 PDF' }).hover()
  await expect(library).toBeVisible()
  expect(await panes()).toEqual(before)
  await page.mouse.move(725, 65)
  await expect(library).toBeHidden()

  await left.press('Enter')
  await expect(library).toBeVisible()
  const search = library.getByRole('searchbox', { name: '搜索 PDF' })
  await search.fill('BETA')
  await expect(library.getByRole('button', { name: /^Alpha[.]pdf/ })).toHaveCount(0)
  await library.getByRole('button', { name: /^Beta[.]pdf/ }).press('Enter')
  await expect(pdfButton(page, 'Beta')).toHaveAttribute('aria-pressed', 'true')
  await expect(library).toBeVisible()
  await expect(library.getByRole('button', { name: /^Beta[.]pdf/ })).toHaveAttribute('aria-current', 'true')
  await search.press('Escape')
  await expect(library).toBeHidden()
  await expect(left).toBeFocused()
  await selectPdf(page, 'Alpha')
  await expect(page.locator('.pdf-file-list .pane-tab')).toHaveCount(2)

  await right.hover()
  await expect(linked).toBeVisible()
  await right.click()
  await page.mouse.move(730, 65)
  await expect(linked).toBeVisible()
  const groups = linked.getByRole('heading', { level: 3 })
  await expect(groups).toHaveCount(2)
  await expect(groups.first()).toContainText('Alpha.pdf')
  const alpha = linked.locator('.linked-card-group').filter({ hasText: 'Alpha.pdf' })
  const beta = linked.locator('.linked-card-group').filter({ hasText: 'Beta.pdf' })
  await expect(alpha.getByRole('button', { name: 'Card 1' })).toBeVisible()
  await expect(alpha.getByRole('button', { name: 'Card 2' })).toBeVisible()
  await beta.getByRole('button', { name: /^Beta[.]pdf/ }).click()
  await expect(beta.getByRole('button', { name: 'Card 1' })).toBeVisible()
  await expect(beta.getByRole('button', { name: 'Card 2' })).toHaveCount(0)
  expect(await panes()).toEqual(before)

  await page.getByRole('separator').press('End')
  await expect(workspace).toHaveAttribute('data-mode', 'pdf')
  await expect(linked).toHaveCount(0)
  await workspace.locator('.card-pane').evaluate((node) => { window.previousCanvas = node.querySelector('.tl-container') })
  await page.getByRole('button', { name: '展开 Card，恢复双栏' }).click()
  await expect(workspace).toHaveAttribute('data-mode', 'split')
  await expect(linked).toBeHidden()
  await right.click()
  await beta.getByRole('button', { name: /^Beta[.]pdf/ }).click()
  await alpha.getByRole('button', { name: 'Card 2' }).click()
  expect(await workspace.locator('.card-pane').evaluate(node => node.querySelector('.tl-container') === window.previousCanvas)).toBe(true)
  const beforeCardIds = (await cardState(page)).items.map(({ id }) => id)
  await beta.getByRole('button', { name: 'Card 1' }).click()
  await expect(cardButton(page, 1)).toHaveAttribute('aria-pressed', 'true')
  await alpha.getByRole('button', { name: 'Card 2' }).click()
  await expect(cardButton(page, 2)).toHaveAttribute('aria-pressed', 'true')
  expect((await cardState(page)).items.map(({ id }) => id)).toEqual(beforeCardIds)
  await right.click()
  await expect(linked).toBeHidden()
  await page.getByRole('button', { name: '关闭 Beta.pdf', exact: true }).click()
  await expect(pdfButton(page, 'Beta')).toHaveCount(0)
  await right.click()
  await expect(linked.getByRole('heading', { name: /Beta/ })).toHaveCount(0)
  await right.press('Escape')
  await page.getByRole('separator').press('Home')
  await expect(workspace).toHaveAttribute('data-mode', 'card')
  await expect(left).toHaveCount(0)
  await page.getByRole('button', { name: '展开 PDF，恢复双栏' }).click()
  await selectPdf(page, 'Beta')
  await expect(workspace).toHaveAttribute('data-mode', 'split')
  await selectPdf(page, 'Alpha')
  await expect(page.locator('.pdf-file-list .pane-tab')).toHaveCount(2)

  const touch = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true })
  try {
    const tablet = await touch.newPage()
    await tablet.goto(origin)
    await tablet.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: 'Workspaces', exact: true }).tap()
    await workspacesPage(tablet).getByRole('button', { name: 'General', exact: true }).tap()
    await expect(workspaceName(tablet, 'General')).toHaveAttribute('aria-current', 'page')
    await pdfHandle(tablet).tap()
    const chooser = tablet.waitForEvent('filechooser')
    await pdfPanel(tablet).getByRole('button', { name: '导入 PDF', exact: true }).tap()
    await (await chooser).setFiles({ name: 'Journal - A deliberately long title for the narrow workspace.pdf',
      mimeType: 'application/pdf', buffer: makePdf('Journal') })
    await expect(pdfPanel(tablet).getByRole('button', { name: /Journal/ })).toHaveAttribute('aria-current', 'true', timeout)
    await pdfHandle(tablet).tap()
    await expect(pdfPanel(tablet)).toBeHidden()
    await cardsHandle(tablet).tap()
    await expect(cardsPanel(tablet).getByText('暂无关联 Card')).toBeVisible(timeout)
    await tablet.setViewportSize({ width: 390, height: 844 })
    const box = await cardsPanel(tablet).boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await cardsPanel(tablet).getByRole('button', { name: '关闭 Linked Cards' }).tap()
    await expect(cardsPanel(tablet)).toBeHidden()
  } finally {
    await touch.close()
  }
  console.log('Floating navigation passed hover, pin, Escape, search, linked grouping, tab reuse, touch and narrow viewport checks.')
}

const libraryPage = (page) => page.getByRole('main', { name: 'Library', exact: true })

async function openLibrary(page) {
  const header = page.getByRole('navigation', { name: '主导航' })
  await header.getByRole('button', { name: 'Home', exact: true }).click()
  await homePage(page).getByRole('button', { name: /^Library/ }).click()
  await expect(libraryPage(page)).toBeVisible()
  return libraryPage(page)
}

async function openGeneral(page) {
  await (await openWorkspaces(page)).getByRole('button', { name: 'General', exact: true }).click()
  await expect(workspaceName(page, 'General')).toHaveAttribute('aria-current', 'page')
}

async function saveFolderName(library, name) {
  await library.getByRole('textbox', { name: '文件夹名称' }).fill(name)
  await library.getByRole('button', { name: '保存', exact: true }).click()
  await expect(library.getByRole('textbox', { name: '文件夹名称' })).toBeHidden()
}

async function verifyLibrary(page) {
  await waitEditor(page)
  await page.evaluate(() => {
    window.libraryStore = window.tlsync.store
    window.libraryPdfPage = document.querySelector('.pdfViewer .page')
  })
  const library = await openLibrary(page)
  expect(await page.evaluate(() => window.libraryStore === window.tlsync.store &&
    window.libraryPdfPage !== null && document.querySelector('.pdfViewer .page') === window.libraryPdfPage)).toBe(true)
  const rootTree = library.getByRole('region', { name: 'PDF 文件树' }).locator('.library-tree').first()
  const create = library.getByRole('button', { name: '新建文件夹', exact: true })
  const option = (name) => ({ label: name })
  const movePdf = (name) => library.getByRole('combobox', { name: '移动 PDF ' + name, exact: true })
  const moveFolder = (name) => library.getByRole('combobox', { name: '移动文件夹 ' + name, exact: true })

  await expect(rootTree.locator(':scope > li.library-document')).toHaveCount(2)
  for (const name of ['Research', 'Archive', 'Disposable']) {
    await create.click()
    await saveFolderName(library, name)
  }
  await library.getByRole('button', { name: '新建子文件夹 Research', exact: true }).click()
  await saveFolderName(library, 'Sources')
  await library.getByRole('button', { name: '重命名 Sources', exact: true }).click()
  await saveFolderName(library, 'Papers')
  await expect(moveFolder('Research').getByRole('option', { name: 'Research / Papers', exact: true })).toHaveCount(0)
  await moveFolder('Papers').selectOption(option('Archive'))
  await expect(moveFolder('Archive').getByRole('option', { name: 'Archive / Papers', exact: true })).toHaveCount(0)
  await moveFolder('Papers').selectOption(option('Research'))
  await expect(movePdf('Alpha.pdf').getByRole('option', { name: 'Research / Papers', exact: true })).toHaveCount(1)
  await movePdf('Alpha.pdf').selectOption(option('Research / Papers'))
  await library.getByRole('button', { name: '新建子文件夹 Disposable', exact: true }).click()
  await saveFolderName(library, 'Retained')
  await movePdf('Beta.pdf').selectOption(option('Disposable'))
  page.once('dialog', dialog => dialog.accept())
  await library.getByRole('button', { name: '删除文件夹 Disposable', exact: true }).click()
  await expect(rootTree.locator(':scope > li.library-document').getByRole('button', { name: 'Beta.pdf', exact: true })).toBeVisible()
  await expect(rootTree.locator(':scope > li.library-folder').getByRole('button', { name: 'Retained', exact: true })).toBeVisible()
  await expect(movePdf('Beta.pdf')).toHaveValue('')
  await movePdf('Beta.pdf').selectOption(option('Archive'))

  await library.getByRole('button', { name: 'All Cards', exact: true }).click()
  const results = library.getByRole('region', { name: 'All Cards', exact: true })
  const filter = library.getByRole('combobox', { name: '按 PDF 文件夹筛选 Card' })
  await filter.selectOption(option('Research'))
  await expect(results.locator('.library-document')).toHaveCount(2)
  await filter.selectOption(option('Archive'))
  await expect(results.locator('.library-document')).toHaveCount(1)
  const card = results.locator('.library-document')
  await expect(card.getByRole('button', { name: 'Card 1', exact: true })).toBeVisible()
  await expect(card.locator('.library-count')).toHaveText('2', timeout)
  await card.locator('summary').click()
  await expect(card.getByRole('button', { name: 'Alpha.pdf', exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Beta.pdf', exact: true }).click()
  await expect(pdfButton(page, 'Beta')).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '新建 Card', exact: true }).click()
  await expect(cardButton(page, 3)).toHaveAttribute('aria-pressed', 'true')
  await waitEditor(page)
  await openLibrary(page)
  await library.getByRole('button', { name: 'All Cards', exact: true }).click()
  await library.getByRole('searchbox', { name: '搜索 Card' }).fill('card 3')
  await expect(results.locator('.library-document')).toHaveCount(1)
  await expect(results.locator('.library-count')).toHaveText('0', timeout)
  await library.getByRole('button', { name: 'PDF', exact: true }).click()
  await library.getByRole('searchbox', { name: '搜索 Library PDF' }).fill('ALPHA')
  const pdf = library.locator('.library-document')
  await expect(pdf).toHaveCount(1)
  await expect(pdf.getByText('Research / Papers', { exact: true }).first()).toBeVisible()
  await pdf.locator('summary').click()
  await pdf.getByRole('button', { name: 'Card 1', exact: true }).click()
  await expect(cardButton(page, 1)).toHaveAttribute('aria-pressed', 'true')
  await waitEditor(page, (await cardState(page)).items[0].persistenceKey)
  await page.reload()
  await openLibrary(page)
  await expect(movePdf('Alpha.pdf').locator('option:checked')).toHaveText('Research / Papers')
  await expect(movePdf('Beta.pdf').locator('option:checked')).toHaveText('Archive')
  await openGeneral(page)
  await waitEditor(page)
  console.log('Library nested folders, moving, safe deletion, virtual Card filters, independent Cards and document opening passed.')
}

function storedLibrary(page) {
  return page.evaluate(() => {
    const dataset = localStorage.getItem('cardinal-notes:active-dataset')
    const key = dataset ? 'cardinal-notes:restore:' + dataset + ':library' : 'cardinal-notes:library'
    return JSON.parse(localStorage.getItem(key))
  })
}

async function writeInvalidLibraryBackup(input, output, change) {
  const { BlobReader, BlobWriter, TextReader, ZipReader, ZipWriter } = await import('@zip.js/zip.js')
  const reader = new ZipReader(new BlobReader(new Blob([fs.readFileSync(input)])))
  const writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false })
  try {
    for (const entry of await reader.getEntries()) {
      const blob = await entry.getData(new BlobWriter(), { useWebWorkers: false })
      if (entry.filename === 'backup.json') {
        const manifest = JSON.parse(await blob.text())
        expect(manifest.version).toBe(3)
        change(manifest.library)
        await writer.add(entry.filename, new TextReader(JSON.stringify(manifest)))
      } else await writer.add(entry.filename, new BlobReader(blob))
    }
    fs.writeFileSync(output, Buffer.from(await (await writer.close()).arrayBuffer()))
  } finally {
    await reader.close()
  }
}

const homePage = (page) => page.getByRole('main', { name: 'Home', exact: true })
const workspacesPage = (page) => page.getByRole('main', { name: 'Workspaces', exact: true })
const workspaceMenu = (page) => page.getByRole('group', { name: '切换工作区' })

async function openWorkspaces(page) {
  const header = page.getByRole('navigation', { name: '主导航' })
  await header.getByRole('button', { name: 'Home', exact: true }).click()
  await homePage(page).getByRole('button', { name: /^Workspaces/ }).click()
  const manager = workspacesPage(page)
  await expect(manager).toBeVisible()
  return manager
}
const workspaceName = (page, name) => page.locator('header.app-header .workspace-menu-trigger').and(page.getByRole('button', { name, exact: true }))

async function manage(page) {
  await page.locator('header.app-header .workspace-menu-trigger').click()
  const menu = workspaceMenu(page)
  await expect(menu).toBeVisible()
  return menu
}

async function switchWorkspace(page, name) {
  const menu = await manage(page)
  await menu.getByRole('button', { name, exact: true }).click()
  await expect(workspaceName(page, name)).toHaveAttribute('aria-current', 'page')
}

async function editWorkspace(page, action, name, previous) {
  const manager = await openWorkspaces(page)
  await manager.getByRole('button', { name: previous ? '重命名 ' + previous : action, exact: true }).click()
  await manager.getByRole('textbox', { name: '工作区名称' }).fill(name)
  await manager.getByRole('button', { name: '保存工作区' }).click()
  if (previous) await manager.getByRole('button', { name, exact: true }).click()
  await expect(workspaceName(page, name)).toHaveAttribute('aria-current', 'page')
}

async function sessionsOf(page) {
  return page.evaluate(() => {
    const dataset = localStorage.getItem('cardinal-notes:active-dataset')
    const prefix = dataset ? 'cardinal-notes:restore:' + dataset + ':' : 'cardinal-notes:'
    return JSON.parse(localStorage.getItem(prefix + 'workspaces'))
  })
}

async function activateExistingCard(page, title) {
  await page.getByRole('combobox', { name: '打开已有 Card' }).selectOption({ label: title })
  await expect(page.getByRole('group', { name: 'Card 列表' }).getByRole('button', { name: title, exact: true }))
    .toHaveAttribute('aria-pressed', 'true')
}

async function verifySessions(page, scratch) {
  await editWorkspace(page, '新建工作区', 'Reading')
  await expect(page.locator('.pdf-file-list .pane-tab')).toHaveCount(0)
  await expect(page.locator('.card-tabs .pane-tab')).toHaveCount(0)
  await expect(page.locator('canvas.tl-canvas')).toHaveCount(0)
  await page.getByLabel('选择 PDF 文件').setInputFiles({
    name: 'Study.pdf', mimeType: 'application/pdf', buffer: makePdf('Study', true),
  })
  await expect(pdfButton(page, 'Study')).toHaveAttribute('aria-pressed', 'true')
  await activateExistingCard(page, 'Card 1')
  await expectImage(page)
  const separator = page.getByRole('separator')
  await separator.press('ArrowRight')
  await expect(separator).toHaveAttribute('aria-valuenow', '55')
  await separator.press('ArrowRight')
  await expect(separator).toHaveAttribute('aria-valuenow', '60')
  await page.getByRole('button', { name: '放大', exact: true }).click()
  const scroll = page.locator('.pdf-scroll')
  await expect(scroll.locator('.page')).toHaveCount(2)
  await scroll.evaluate((node) => { node.scrollTop += node.querySelector('[data-page-number="2"]').offsetTop + 130 })
  const pdfIds = await getPdfs(page)
  const studyId = pdfIds['Study.pdf']
  const reading = async () => (await sessionsOf(page)).items.find(({ name }) => name === 'Reading')
  await expect.poll(async () => (await reading()).reading[studyId]?.page, timeout).toBe(2)
  const atTwo = (await reading()).reading[studyId]
  const zoom = await page.getByLabel('缩放比例').textContent()
  expect(atTwo.scale).not.toBe('page-width')
  await page.locator('[data-shape-id="shape:first-b"]').click({ button: 'right', force: true })
  const jumpToSource = page.getByText('跳转到 PDF 来源', { exact: true })
  await expect(jumpToSource).toBeVisible()
  await expect(page.getByTestId('context-menu-sub.move-to-page-button')).toHaveCount(0)
  await jumpToSource.click()
  await expect(workspaceName(page, 'Reading')).toHaveAttribute('aria-current', 'page')
  await expect(pdfButton(page, 'Beta')).toHaveAttribute('aria-pressed', 'true')
  await selectPdf(page, 'Study')
  await page.evaluate(() => window.tlsync.store.update('shape:photo', (shape) => ({ ...shape, y: shape.y + 7 })))
  await editWorkspace(page, '新建工作区', 'Review')
  await selectPdf(page, 'Alpha')
  await cardsHandle(page).click()
  await cardsPanel(page).getByRole('button', { name: 'Card 2', exact: true }).click()
  await cardsHandle(page).press('Escape')
  await expect(cardButton(page, 2)).toHaveAttribute('aria-pressed', 'true')
  await selectPdf(page, 'Study')
  const review = async () => (await sessionsOf(page)).items.find(({ name }) => name === 'Review')
  await expect.poll(async () => (await review()).reading[studyId]?.page, timeout).toBe(1)
  await expect(page.getByRole('separator')).toHaveAttribute('aria-valuenow', '50')
  await activateExistingCard(page, 'Card 1')
  await expectImage(page)
  expect(await page.evaluate(() => window.tlsync.store.get('shape:photo').y)).toBe(82)
  await page.getByRole('button', { name: '关闭 Card 1', exact: true }).click()
  await expect(cardButton(page, 1)).toHaveCount(0)
  await expect(cardButton(page, 2)).toHaveAttribute('aria-pressed', 'true')
  const menu = await manage(page)
  await menu.getByRole('button', { name: 'Reading', exact: true }).evaluate((button) => {
    window.tlsync.store.update('shape:second-a', (shape) => ({ ...shape, y: shape.y + 11 }))
    button.click()
  })
  await expect(workspaceName(page, 'Reading')).toHaveAttribute('aria-current', 'page')
  await expect(cardButton(page, 1)).toHaveAttribute('aria-pressed', 'true')
  await expect(pdfButton(page, 'Alpha')).toHaveCount(0)
  await expect(pdfButton(page, 'Study')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('separator')).toHaveAttribute('aria-valuenow', '60')
  await expect(page.getByLabel('缩放比例')).toHaveText(zoom)
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop), timeout).toBeGreaterThan(500)
  await page.reload()
  await expect(workspaceName(page, 'Reading')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('separator')).toHaveAttribute('aria-valuenow', '60')
  await expect(page.getByLabel('缩放比例')).toHaveText(zoom)
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop), timeout).toBeGreaterThan(500)
  await expectImage(page)

  const remembered = (await sessionsOf(page)).activeId
  await page.evaluate(() => { window.beforeHomeStore = window.tlsync.store })
  const header = page.getByRole('navigation', { name: '主导航' })
  await header.getByRole('button', { name: 'Home', exact: true }).click()
  await expect(homePage(page)).toBeVisible()
  expect(await page.evaluate(() => window.beforeHomeStore === window.tlsync.store)).toBe(true)
  await openLibrary(page)
  expect((await sessionsOf(page)).activeId).toBe(remembered)
  await page.reload()
  await expect(workspaceName(page, 'Reading')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('separator')).toHaveAttribute('aria-valuenow', '60')

  await switchWorkspace(page, 'Review')
  await waitEditor(page)
  expect(await page.evaluate(() => window.tlsync.store.get('shape:second-a').y)).toBe(86)
  await editWorkspace(page, '重命名工作区', 'Revision', 'Review')
  const library = await openLibrary(page)
  await library.getByRole('button', { name: 'Beta.pdf', exact: true }).click()
  await expect(workspaceName(page, 'General')).toHaveAttribute('aria-current', 'page')
  await expect(pdfButton(page, 'Beta')).toHaveAttribute('aria-pressed', 'true')
  await switchWorkspace(page, 'Revision')
  page.once('dialog', dialog => dialog.accept())
  await (await manage(page)).getByRole('button', { name: '清空打开的标签' }).click()
  await expect(page.locator('.pdf-file-list .pane-tab')).toHaveCount(0)
  await expect(page.locator('.card-tabs .pane-tab')).toHaveCount(0)
  const downloadEvent = page.waitForEvent('download', timeout)
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('button', { name: '导出备份', exact: true }).click()
  await (await downloadEvent).saveAs(path.join(scratch, 'from-empty-workspace.zip'))
  await expect(page.getByText('备份已生成，下载已开始。')).toBeVisible()
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('Library 文档会保留')
    await dialog.accept()
  })
  const manager = await openWorkspaces(page)
  await expect(manager.getByRole('button', { name: '删除 General', exact: true })).toHaveCount(0)
  await manager.getByRole('button', { name: '删除 Revision', exact: true }).click()
  await expect(manager.getByRole('button', { name: 'Revision', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(homePage(page)).toBeVisible()
  await openGeneral(page)
  await expectImage(page)
  expect((await sessionsOf(page)).items.map(({ name }) => name)).toEqual(['General', 'Reading'])

  // Put a dispensable PDF and Card in both workspaces for the post-restore cleanup check.
  await page.getByLabel('选择 PDF 文件').setInputFiles({
    name: 'Temporary.pdf', mimeType: 'application/pdf', buffer: makePdf('Temporary'),
  })
  await expect(pdfButton(page, 'Temporary')).toHaveAttribute('aria-pressed', 'true')
  await activateExistingCard(page, 'Card 3')
  await switchWorkspace(page, 'Reading')
  await selectPdf(page, 'Temporary')
  await activateExistingCard(page, 'Card 3')
  await selectPdf(page, 'Study')
  await activateExistingCard(page, 'Card 1')
  await switchWorkspace(page, 'General')
  await selectPdf(page, 'Beta')
  await activateExistingCard(page, 'Card 1')
  console.log('Workspace creation, independent tabs and PDF position, reload, shared canvas, clear, deletion, and empty backup passed.')
}

async function verifyWorkspaceCleanup(page) {
  const library = await openLibrary(page)
  page.once('dialog', dialog => dialog.accept())
  await library.getByRole('button', { name: '永久删除 Beta.pdf', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('仍被 Card 引用', timeout)
  await page.getByRole('button', { name: '关闭错误' }).click()
  await expect(library.getByRole('button', { name: 'Beta.pdf', exact: true })).toBeVisible()
  const temporary = (await getPdfs(page))['Temporary.pdf']
  const card = (await cardState(page)).items.find(({ title }) => title === 'Card 3').id
  page.once('dialog', dialog => dialog.accept())
  await library.getByRole('button', { name: '永久删除 Temporary.pdf', exact: true }).click()
  await expect(library.getByRole('button', { name: 'Temporary.pdf', exact: true })).toHaveCount(0)
  await library.getByRole('button', { name: 'All Cards', exact: true }).click()
  page.once('dialog', dialog => dialog.accept())
  await library.getByRole('button', { name: '永久删除 Card 3', exact: true }).click()
  await expect(library.getByRole('button', { name: 'Card 3', exact: true })).toHaveCount(0)
  await expect.poll(async () => (await sessionsOf(page)).items.every((session) =>
    !session.pdf.ids.includes(temporary) && !session.card.ids.includes(card) && !(temporary in session.reading)), timeout).toBe(true)
  await openGeneral(page)
  console.log('Permanent Library deletions pruned every workspace and protected referenced PDF sources.')
}

async function verifyCardUi(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))

  try {
    await page.goto(origin)
    await openGeneral(page)
    await waitEditor(page)

    const toolbar = page.getByRole('toolbar', { name: 'Card 工具' })
    const styles = page.getByRole('group', { name: 'Card 样式' })
    const controls = (name) => styles.getByRole('group', { name, exact: true })
    const favorites = controls('常用颜色')
    const color = (name) => favorites.getByRole('button', { name, exact: true })
    const paletteTrigger = favorites.getByRole('button', { name: '全部颜色', exact: true })
    const palette = page.getByRole('group', { name: '全部原生颜色' })
    const opacity = styles.getByRole('slider', { name: '不透明度' })
    const more = toolbar.getByRole('button', { name: /^更多工具/ })
    const selectTool = (id) => toolbar.getByTestId('tools.' + id)
    const canvas = page.getByTestId('canvas')

    for (const id of ['select', 'hand', 'draw', 'eraser', 'text', 'highlight', 'rectangle', 'ellipse']) {
      await expect(selectTool(id)).toBeVisible()
    }
    await expect(toolbar.getByTestId('toolbar.undo')).toBeDisabled()
    await expect(toolbar.getByTestId('toolbar.redo')).toBeDisabled()
    await expect(page.getByTestId('page-menu.button')).toHaveCount(0)
    await expect(styles).toHaveCount(0)
    await more.tap()
    const menu = page.getByRole('menu')
    for (const id of ['arrow', 'line', 'note', 'frame', 'asset', 'laser']) {
      await expect(menu.getByTestId('toolbar.' + id)).toBeAttached()
    }
    await expect(menu.locator('.card-extra-tool-label').first()).toBeVisible()
    await menu.getByTestId('toolbar.arrow').tap()
    await expect(more).toHaveAttribute('data-isactive', 'true')
    await selectTool('ellipse').tap()
    await expect(selectTool('ellipse')).toHaveAttribute('aria-pressed', 'true')
    await selectTool('rectangle').tap()
    await expect(selectTool('rectangle')).toHaveAttribute('aria-pressed', 'true')
    await expect(controls('填充').getByRole('button')).toHaveCount(6)
    await expect(controls('线型').getByRole('button')).toHaveCount(5)
    await controls('填充').getByRole('button', { name: '填充：网纹', exact: true }).tap()
    await expect(controls('填充').getByRole('button', { name: '填充：网纹', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await selectTool('text').tap()
    await expect(controls('字号')).toBeVisible()
    await expect(controls('字体').getByRole('button')).toHaveCount(4)
    await controls('字体').getByRole('button', { name: '字体：衬线', exact: true }).tap()
    await expect(controls('字体').getByRole('button', { name: '字体：衬线', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(controls('填充')).toHaveCount(0)
    await selectTool('hand').tap()
    await expect(styles).toHaveCount(0)
    await selectTool('highlight').tap()
    await expect(selectTool('highlight')).toHaveAttribute('aria-pressed', 'true')
    await selectTool('draw').tap()
    await expect(controls('粗细').getByRole('button')).toHaveCount(4)
    await paletteTrigger.tap()
    await expect(palette.locator('.card-color-cell')).toHaveCount(13)
    await palette.getByRole('button', { name: '加入常用颜色：紫色', exact: true }).tap()
    await palette.getByRole('button', { name: '移出常用颜色：黄色', exact: true }).tap()
    await paletteTrigger.tap()
    await expect(color('紫色')).toBeVisible()
    await expect(color('黄色')).toHaveCount(0)
    await color('紫色').dragTo(color('蓝色'))
    const savedColors = () => page.evaluate(() => JSON.parse(localStorage.getItem('cardinal-notes:card-favorite-colors')))
    await expect.poll(savedColors).toEqual(['black', 'violet', 'blue', 'red', 'green'])
    const touch = await context.newCDPSession(page)
    const red = await color('红色').boundingBox()
    const blue = await color('蓝色').boundingBox()
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: red.x + red.width / 2, y: red.y + red.height / 2 }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: blue.x + blue.width / 2, y: blue.y + blue.height / 2 }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(savedColors).toEqual(['black', 'violet', 'red', 'blue', 'green'])
    await color('蓝色').tap()
    await expect(color('蓝色')).toHaveAttribute('aria-pressed', 'true')
    await controls('粗细').getByRole('button', { name: '粗细：较粗', exact: true }).tap()
    await controls('线型').getByRole('button', { name: '线型：虚线', exact: true }).tap()
    await opacity.fill('65')
    const area = await canvas.boundingBox()
    const x = area.x + area.width * .45
    const y = area.y + area.height * .4
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 44, y + 9, { steps: 12 })
    await page.mouse.up()
    const strokes = () => page.evaluate(() => window.tlsync.store.allRecords().filter((r) => r.type === 'draw'))
    await expect.poll(async () => (await strokes()).map(({ props, opacity }) => [props.color, props.size, props.dash, opacity]))
      .toEqual([['blue', 'l', 'dashed', 0.65]])
    await toolbar.getByTestId('toolbar.undo').click()
    await expect.poll(async () => (await strokes()).length).toBe(0)
    await toolbar.getByTestId('toolbar.redo').click()
    await expect.poll(async () => (await strokes()).length).toBe(1)
    await page.keyboard.press('v')
    await expect(selectTool('select')).toHaveAttribute('aria-pressed', 'true')
    await expect(styles).toHaveCount(0)
    await page.mouse.click(x + 18, y + 4)
    await expect(controls('粗细')).toBeVisible()
    await page.keyboard.press('Control+Enter')
    await expect(color('黑色')).toBeFocused()
    await color('红色').tap()
    await opacity.fill('40')
    await expect.poll(async () => {
      const [shape] = await strokes()
      return [shape?.props.color, shape?.opacity]
    }).toEqual(['red', 0.4])

    // A legacy page remains intact and the disabled UI shortcut cannot switch to it.
    const currentPage = (await strokes())[0].parentId
    await page.evaluate((currentPage) => {
      const store = window.tlsync.store
      store.put([{ ...store.get(currentPage), id: 'page:legacy-card-ui', index: 'a2', name: 'Legacy page' }])
    }, currentPage)
    await canvas.click({ position: { x: 120, y: 190 } })
    await page.keyboard.press('Alt+ArrowRight')
    const pageState = () => page.evaluate(() => {
      const records = window.tlsync.store.allRecords()
      return { current: records.find((r) => r.typeName === 'instance').currentPageId,
        pages: records.filter((r) => r.typeName === 'page').map((r) => r.id).sort() }
    })
    expect(await pageState()).toEqual({ current: currentPage, pages: [currentPage, 'page:legacy-card-ui'].sort() })
    await page.getByRole('button', { name: '新建 Card', exact: true }).click()
    await expect(cardButton(page, 2)).toHaveAttribute('aria-pressed', 'true')
    await cardButton(page, 1).click()
    const { items: [first] } = await cardState(page)
    await waitEditor(page, first.persistenceKey)
    expect((await strokes())[0].props.color).toBe('red')
    await page.reload()
    await waitEditor(page, first.persistenceKey)
    expect((await strokes())[0].props.color).toBe('red')
    expect(await pageState()).toEqual({ current: currentPage, pages: [currentPage, 'page:legacy-card-ui'].sort() })
    await expect(page.getByTestId('page-menu.button')).toHaveCount(0)
    expect(await savedColors()).toEqual(['black', 'violet', 'red', 'blue', 'green'])

    await page.setViewportSize({ width: 390, height: 768 })
    await selectTool('text').tap()
    await expect(controls('字号')).toBeVisible()
    const pane = await page.locator('.card-pane').boundingBox()
    const bar = await toolbar.boundingBox()
    const styleBar = await styles.boundingBox()
    expect(Math.abs(bar.x + bar.width / 2 - pane.x - pane.width / 2)).toBeLessThan(1)
    expect(bar.width).toBeLessThanOrEqual(pane.width)
    expect(styleBar.y + styleBar.height).toBeLessThan(bar.y)
    await expect(more).toBeInViewport()
    await paletteTrigger.tap()
    await expect(palette).toBeVisible()
    const paletteBox = await palette.boundingBox()
    expect(paletteBox.x).toBeGreaterThanOrEqual(pane.x - 1)
    expect(paletteBox.x + paletteBox.width).toBeLessThanOrEqual(pane.x + pane.width + 1)
    await paletteTrigger.tap()
    await more.tap()
    await expect(menu.getByTestId('toolbar.arrow')).toBeInViewport()
    const toolsGrid = await menu.locator('.card-more-grid').boundingBox()
    expect(toolsGrid.x).toBeGreaterThanOrEqual(pane.x - 1)
    expect(toolsGrid.x + toolsGrid.width).toBeLessThanOrEqual(pane.x + pane.width + 1)
    expect(errors).toEqual([])
    console.log('Card direct styles, favorite colors with mouse and touch reordering, history, and narrow pane boundaries passed.')
  } finally {
    await context.close()
  }
}

async function run() {
  if (verifyLegacy) buildOld()
  let dist = verifyLegacy ? oldDist : newDist
  const mime = { '.html': 'text/html;charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
  const server = http.createServer((request, response) => {
    const route = new URL(request.url, 'http://localhost').pathname
    const file = path.join(dist, route === '/' ? 'index.html' : route)
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  let browser
  try {
    // Use installed Chrome by default. Pass --chromium to use Playwright's browser.
    browser = await chromium.launch({ channel: process.argv.includes('--chromium') ? undefined : 'chrome' })
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1480, height: 950 } })
    const page = await context.newPage()
    const errors = []
    context.on('page', open => open.on('pageerror', error => errors.push(error.message)))
    page.on('pageerror', error => errors.push(error.message))
    await context.addInitScript(() => {
      const getAll = IDBObjectStore.prototype.getAll
      window.shapeReads = []
      IDBObjectStore.prototype.getAll = function (query, count) {
        if (this.name === 'records' && query?.lower === 'shape:') {
          const name = this.transaction.db.name
          window.shapeReads.push(name)
          if (sessionStorage.getItem('test-failed-shape-read') === name) throw new DOMException('test read failure')
        }
        return getAll.apply(this, arguments)
      }
    })
    await page.goto(origin)
    if (!verifyLegacy) {
      await expect(homePage(page)).toBeVisible()
      await expect(page.locator('.editor-page')).toBeHidden()
      expect((await sessionsOf(page))?.activeId ?? null).toBeNull()
      await openGeneral(page)
    }
    await waitEditor(page)
    await page.locator('input[aria-label="选择 PDF 文件"], .pdf-bar input').setInputFiles([
      { name: 'Alpha.pdf', mimeType: 'application/pdf', buffer: makePdf('Alpha') },
      { name: 'Beta.pdf', mimeType: 'application/pdf', buffer: makePdf('Beta') },
    ])
    await expect(pdfButton(page, 'Beta')).toBeVisible(timeout)
    const pdfIds = await getPdfs(page)
    const { items: [first] } = await cardState(page)
    await putShapes(page, pdfIds['Alpha.pdf'], [{ id: 'first-a', regionX: 45, index: 'a1' }], true)
    await putShapes(page, pdfIds['Beta.pdf'], [{ id: 'first-b', regionX: 135, index: 'a2', x: 230 }])
    await page.getByRole('button', { name: '新建 Card', exact: true }).click()
    await expect(cardButton(page, 2)).toHaveAttribute('aria-pressed', 'true')
    const { items: [, second] } = await cardState(page)
    await waitEditor(page, second.persistenceKey)
    await putShapes(page, pdfIds['Alpha.pdf'], [{ id: 'second-a', regionX: 210, index: 'a1' }])
    await selectPdf(page, 'Alpha')
    await expect(marker(page)).toHaveCount(2, timeout)
    const oldZip = path.join(scratch, 'old.zip')
    const newZip = path.join(scratch, 'new.zip')
    await download(page, oldZip)
    console.log('Two Cards, two PDFs, three region shapes and an image exported as a workspace backup.')

    dist = newDist
    await page.reload()
    if (verifyLegacy) {
      await expect(homePage(page)).toBeVisible()
      await openGeneral(page)
    }
    await waitEditor(page, second.persistenceKey)
    await expect(marker(page)).toHaveCount(2, timeout)
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.length, cachePrefix + first.persistenceKey), timeout).toBe(2)
    await page.reload()
    await waitEditor(page, second.persistenceKey)
    await expect(marker(page)).toHaveCount(2, timeout)
    expect(await page.evaluate(() => window.shapeReads)).not.toContain('TLDRAW_DOCUMENT_v2' + first.persistenceKey)
    await selectPdf(page, 'Beta')
    await expect(marker(page)).toHaveCount(1, timeout)
    await marker(page).getByRole('button').click()
    await waitEditor(page, first.persistenceKey)
    await expectImage(page)
    await cardButton(page, 2).click()
    await waitEditor(page, second.persistenceKey)
    await selectPdf(page, 'Alpha')
    await expect(marker(page)).toHaveCount(2, timeout)
    await expect.poll(() => page.evaluate(key => Boolean(localStorage.getItem(key)), cachePrefix + first.persistenceKey), timeout).toBe(true)
    await page.evaluate(key => localStorage.setItem(key, '{"invalid":true}'), cachePrefix + first.persistenceKey)
    await page.reload()
    await expect(marker(page)).toHaveCount(2, timeout)
    expect(await page.evaluate(() => window.shapeReads)).toContain('TLDRAW_DOCUMENT_v2' + first.persistenceKey)
    await page.evaluate(({ key, db }) => {
      sessionStorage.setItem('test-failed-shape-read', db)
      localStorage.removeItem(key)
    }, { key: cachePrefix + first.persistenceKey, db: 'TLDRAW_DOCUMENT_v2' + first.persistenceKey })
    await page.reload()
    await expect(marker(page)).toHaveCount(1, timeout)
    await expect(page.getByText('部分 PDF 引用尚未确认。')).toBeVisible()
    await selectPdf(page, 'Beta')
    await cardsHandle(page).click()
    await expect(cardsPanel(page).getByText('部分 PDF 引用尚未确认。')).toBeVisible()
    await expect(cardsPanel(page).getByText('等待确认关联…')).toBeVisible()
    await expect(cardsPanel(page).getByText('暂无关联 Card')).toHaveCount(0)
    await cardsHandle(page).press('Escape')
    const uncertain = await openLibrary(page)
    await expect(uncertain.getByRole('status').filter({ hasText: '关联结果可能不完整' })).toBeVisible()
    const beta = uncertain.locator('.library-document').filter({ has: page.getByRole('button', { name: 'Beta.pdf', exact: true }) })
    await beta.locator('summary').click()
    await expect(beta.getByText('关联尚未确认。', { exact: true })).toBeVisible()
    await expect(beta.getByText('暂无关联 Card。', { exact: true })).toHaveCount(0)
    await openGeneral(page)
    await selectPdf(page, 'Alpha')
    await page.evaluate(() => sessionStorage.removeItem('test-failed-shape-read'))
    await expect(marker(page)).toHaveCount(2, timeout)
    await expect(page.getByText('部分 PDF 引用尚未确认。')).toHaveCount(0)
    console.log('Inactive references work; valid indexes skip reads, and missing or malformed indexes rebuild after errors.')
    await verifyCardUi(browser, origin)
    await verifyLayout(page, browser, origin)
    await verifyNavigation(page, browser, origin)

    const peer = await context.newPage()
    await peer.goto(origin)
    await editWorkspace(peer, '新建工作区', 'Peer')
    await activateExistingCard(peer, 'Card 1')
    await waitEditor(peer, first.persistenceKey)
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), cachePrefix + first.persistenceKey), timeout).toBe(null)
    await putShapes(peer, pdfIds['Alpha.pdf'], [{ id: 'peer-a', regionX: 330, index: 'a4' }])
    await expect(marker(page)).toHaveCount(3, timeout)
    const positions = () => marker(page).evaluateAll(nodes => nodes.map(node => node.style.left).sort().join(','))
    const oldPositions = await positions()
    await peer.evaluate(() => {
      const store = window.tlsync.store
      store.update('shape:peer-a', shape => ({ ...shape, props: { ...shape.props, xMin: 405, xMax: 470 } }))
    })
    await expect.poll(positions, timeout).not.toBe(oldPositions)
    await peer.evaluate(() => window.tlsync.store.remove(['shape:peer-a']))
    await expect(marker(page)).toHaveCount(2, timeout)
    await putShapes(peer, pdfIds['Alpha.pdf'], [{ id: 'crash-a', regionX: 335, index: 'a4' }])
    await expect(marker(page)).toHaveCount(3, timeout)
    const cdp = await context.newCDPSession(peer)
    // Terminate without running React cleanup or delivering the tab's close signal.
    void cdp.send('Page.crash').catch(() => {})
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.length, cachePrefix + first.persistenceKey), timeout).toBe(3)
    await expect(marker(page)).toHaveCount(3, timeout)
    await peer.close()
    console.log('Peer add/update/delete were reconciled; a crashed peer left no permanent dirty index.')

    const blank = await browser.newContext({ acceptDownloads: true, viewport: { width: 1480, height: 950 } })
    const restored = await blank.newPage()
    restored.on('pageerror', error => errors.push(error.message))
    await restored.goto(origin)
    await expect(homePage(restored)).toBeVisible()
    await restore(restored, oldZip)
    await expect(marker(restored)).toHaveCount(2, timeout)
    expect((await cardState(restored)).items.map(c => c.id)).toEqual([first.id, second.id])
    await cardButton(restored, 1).click()
    await waitEditor(restored, (await cardState(restored)).items[0].persistenceKey)
    await expectImage(restored)
    await restored.evaluate(() => {
      const store = window.tlsync.store
      store.update('shape:photo', shape => ({ ...shape, x: 390 }))
      const camera = store.allRecords().find(record => record.typeName === 'camera')
      store.put([{ ...camera, x: 12, z: 0.95 }])
    })
    await selectPdf(restored, 'Beta')
    await expect(marker(restored)).toHaveCount(1, timeout)
    await restored.waitForFunction(() => window.tlsync?.diffQueue.length === 0 && !window.tlsync.isPersisting)
    await restored.reload()
    await expect(marker(restored)).toHaveCount(1, timeout)
    await expectImage(restored)
    expect(await restored.evaluate(() => window.tlsync.store.get('shape:photo').x)).toBe(390)
    await verifyLibrary(restored)
    await verifySessions(restored, scratch)
    const savedLibrary = await storedLibrary(restored)
    await restored.getByRole('separator').press('End')
    await expect(restored.locator('#card-pane')).toBeHidden()
    await download(restored, newZip)
    const savedSessions = await sessionsOf(restored)
    await expect(restored.locator('.split-workspace')).toHaveAttribute('data-mode', 'pdf')
    console.log('Backup without folders restored into a blank context; IDs, PDF links, image bytes and reload were verified.')

    const clean = await browser.newContext({ viewport: { width: 1480, height: 950 } })
    const imported = await clean.newPage()
    await imported.goto(origin)
    await expect(homePage(imported)).toBeVisible()
    await restore(imported, newZip)
    const restoredSessions = await sessionsOf(imported)
    const sessionTabs = ({ items }) => items.map(({ id, name, pdf, card, layout }) => ({ id, name, pdf, card, layout }))
    expect(restoredSessions.activeId).toBe(savedSessions.activeId)
    expect(sessionTabs(restoredSessions)).toEqual(sessionTabs(savedSessions))
    expect(restoredSessions.items.find(({ name }) => name === 'Reading').reading).toEqual(
      savedSessions.items.find(({ name }) => name === 'Reading').reading)
    await switchWorkspace(imported, 'Reading')
    await expect(pdfButton(imported, 'Study')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => imported.locator('.pdf-scroll').evaluate(node => node.scrollTop), timeout).toBeGreaterThan(500)
    await switchWorkspace(imported, 'General')
    await expectImage(imported)
    await expect(marker(imported)).toHaveCount(1, timeout)
    expect(await imported.evaluate(() => ({
      imageX: window.tlsync.store.get('shape:photo').x,
      zoom: window.tlsync.store.allRecords().find(record => record.typeName === 'camera').z,
    }))).toEqual({ imageX: 390, zoom: 0.95 })
    await imported.evaluate(() => {
      const dataset = localStorage.getItem('cardinal-notes:active-dataset')
      const key = 'cardinal-notes:restore:' + dataset + ':workspaces'
      const saved = JSON.parse(localStorage.getItem(key))
      localStorage.setItem(key, JSON.stringify({ ...saved, activeId: 'missing' }))
    })
    await imported.reload()
    await expect(homePage(imported)).toBeVisible()
    const manager = await openWorkspaces(imported)
    await expect(manager.getByRole('button', { name: 'Reading', exact: true })).toBeVisible()
    await manager.getByRole('button', { name: 'General', exact: true }).click()
    await expectImage(imported)
    const pointer = await imported.evaluate(() => localStorage.getItem('cardinal-notes:active-dataset'))
    const library = await openLibrary(imported)
    await expect(library.getByRole('combobox', { name: '移动 PDF Alpha.pdf' }).locator('option:checked')).toHaveText('Research / Papers')
    await expect(library.getByRole('combobox', { name: '移动 PDF Beta.pdf' }).locator('option:checked')).toHaveText('Archive')
    await expect(library.getByRole('button', { name: 'Retained', exact: true })).toBeVisible()
    await openGeneral(imported)
    expect(await storedLibrary(imported)).toEqual(savedLibrary)
    const cycleZip = path.join(scratch, 'cycle.zip')
    await writeInvalidLibraryBackup(newZip, cycleZip, (data) => {
      data.folders[0].parentId = data.folders[0].id
    })
    await imported.getByLabel('选择 ZIP 备份').setInputFiles(cycleZip)
    await expect(imported.getByRole('alert')).toContainText('循环嵌套', timeout)
    expect(await imported.evaluate(() => localStorage.getItem('cardinal-notes:active-dataset'))).toBe(pointer)
    const orphanZip = path.join(scratch, 'orphan.zip')
    await writeInvalidLibraryBackup(newZip, orphanZip, (data) => {
      data.placements[0].pdfId = '00000000-0000-0000-0000-000000000000'
    })
    await imported.getByLabel('选择 ZIP 备份').setInputFiles(orphanZip)
    await expect(imported.getByRole('alert')).toContainText('无效的文件夹或 PDF 位置', timeout)
    expect(await imported.evaluate(() => localStorage.getItem('cardinal-notes:active-dataset'))).toBe(pointer)
    await expectImage(imported)
    console.log('ZIP v3 restored folder IDs and placements. Malformed folder hierarchy was rejected before staging.')
    await imported.evaluate(() => {
      const set = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key === 'cardinal-notes:active-dataset') throw new DOMException('test disk exhaustion', 'QuotaExceededError')
        return set.call(this, key, value)
      }
    })
    imported.once('dialog', dialog => dialog.accept())
    await imported.getByLabel('选择 ZIP 备份').setInputFiles(oldZip)
    await expect(imported.getByRole('alert')).toContainText('当前数据仍可使用', timeout)
    expect(await imported.evaluate(() => localStorage.getItem('cardinal-notes:active-dataset'))).toBe(pointer)
    await imported.reload()
    await expectImage(imported)
    await expect(marker(imported)).toHaveCount(1, timeout)
    await verifyWorkspaceCleanup(imported)
    await selectPdf(imported, 'Alpha')
    await expect(marker(imported)).toHaveCount(2, timeout)
    imported.once('dialog', dialog => dialog.accept())
    const deletionLibrary = await openLibrary(imported)
    await deletionLibrary.getByRole('button', { name: 'All Cards', exact: true }).click()
    await deletionLibrary.getByRole('button', { name: '永久删除 Card 1', exact: true }).click()
    await openGeneral(imported)
    await expect(marker(imported)).toHaveCount(1, timeout)
    await imported.reload()
    await expect(marker(imported)).toHaveCount(1, timeout)
    expect(errors).toEqual([])
    console.log('Current ZIP round trip passed; forced activation failure preserved data; Card deletion removed only its own references after reload.')
  } finally {
    await browser?.close()
    server.close()
  }
}

run().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  if (path.dirname(fs.realpathSync(scratch)).toLowerCase() !== tempRoot.toLowerCase() ||
      !path.basename(scratch).startsWith('cardinal-reference-fixtures-')) throw new Error('Unexpected test directory')
  for (const link of ['node_modules', 'public']) {
    const entry = path.join(scratch, 'old', link)
    if (fs.existsSync(entry) && fs.lstatSync(entry).isSymbolicLink()) fs.unlinkSync(entry)
  }
  fs.rmSync(scratch, { recursive: true, force: true })
})
