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

function makePdf(label, pageCount = 1, withOutline = false) {
  const children = [3, ...Array.from({ length: pageCount - 1 }, (_, index) => index + 6)]
  const stream = '0.0 0.4 0.7 rg 40 650 110 110 re f\nBT /F1 18 Tf 100 600 Td (' + label + ') Tj ET'
  const parts = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count ' + pageCount + ' /Kids [' + children.map(id => id + ' 0 R').join(' ') + '] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream',
  ]
  for (let page = 2; page <= pageCount; page++) parts.push(parts[2])
  if (withOutline) {
    parts[0] = '<< /Type /Catalog /Pages 2 0 R /Outlines 7 0 R >>'
    parts[5] = parts[5].replace('/MediaBox', '/Rotate 90 /MediaBox')
    parts.push('<< /Type /Outlines /First 8 0 R /Last 8 0 R /Count 1 >>',
      '<< /Title (Second chapter) /Parent 7 0 R /Dest [6 0 R /Fit] >>')
  }
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

async function verifyIosSafeArea(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true })
  try {
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    const insets = (top, left = 0) => cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top, left, right: 0 } })
    const header = page.locator('.app-header')
    const viewport = page.locator('meta[name="viewport"]')
    await insets(24)
    await page.goto(origin)
    await expect(header).toHaveCSS('padding-top', '0px')
    await expect(viewport).not.toHaveAttribute('content', /viewport-fit/)
    await page.addInitScript(() => {
      window.webkit = { messageHandlers: { bridge: {} } }
    })
    await page.reload()
    await expect(viewport).toHaveAttribute('content', /viewport-fit=cover/)
    await openGeneral(page)
    await waitEditor(page)
    await page.getByLabel('选择 PDF 文件').setInputFiles({
      name: 'Safe area.pdf', mimeType: 'application/pdf', buffer: makePdf('Safe area'),
    })
    const pdf = page.locator('.pdfViewer .page').first()
    const card = page.locator('.card-editor .tl-canvas')
    await expect(pdf).toBeVisible(timeout)
    await expect(card).toBeVisible()
    await page.evaluate(() => {
      window.safeAreaNodes = [document.querySelector('.pdfViewer .page'), document.querySelector('.card-editor .tl-canvas')]
    })

    for (const { width, height, top, left } of [
      { width: 1024, height: 768, top: 24, left: 18 },
      { width: 768, height: 1024, top: 32, left: 0 },
      { width: 768, height: 1024, top: 0, left: 0 },
    ]) {
      await page.setViewportSize({ width, height })
      await insets(top, left)
      await expect(header).toHaveCSS('padding-top', top + 'px')
      await expect(header).toHaveCSS('padding-left', (14 + left) + 'px')
      const headerBounds = await header.boundingBox()
      const homeBounds = await header.getByRole('button', { name: 'Home' }).boundingBox()
      const workspace = await page.locator('.app-workspace').boundingBox()
      expect(homeBounds.y).toBeGreaterThanOrEqual(top)
      expect(workspace.y).toBeCloseTo(headerBounds.y + headerBounds.height, 0)
      expect(workspace.y + workspace.height).toBeCloseTo(height, 0)
      const menu = await manage(page)
      expect((await menu.boundingBox()).y).toBeCloseTo(workspace.y, 0)
      await workspaceName(page, 'General').press('Escape')
      const more = header.getByRole('button', { name: '更多操作' })
      await more.tap()
      const actions = page.getByRole('group', { name: '备份操作' })
      await expect(actions).toBeVisible()
      expect((await actions.boundingBox()).y).toBeCloseTo(workspace.y - 4, 0)
      await more.press('Escape')
      expect(await page.evaluate(() =>
        window.safeAreaNodes[0] === document.querySelector('.pdfViewer .page') &&
        window.safeAreaNodes[1] === document.querySelector('.card-editor .tl-canvas'),
      )).toBe(true)
    }
    console.log('Native iOS safe-area overrides followed rotation and inset changes; header menus aligned and PDF/Card stayed mounted.')
  } finally {
    await context.close()
  }
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
    name: 'Study.pdf', mimeType: 'application/pdf', buffer: makePdf('Study', 2),
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
    const moreStyle = styles.getByRole('button', { name: '更多样式', exact: true })
    const moreStyles = page.getByRole('group', { name: '更多样式', exact: true })
    const extra = (id) => moreStyles.getByTestId('style.' + id)
    const opacity = moreStyles.getByRole('slider')
    const more = toolbar.getByRole('button', { name: /^更多工具/ })
    const selectTool = (id) => toolbar.getByTestId('tools.' + id)
    const canvas = page.getByTestId('canvas')

    const sizeButton = (group, name) => controls(group).getByRole('button', { name: group + '：' + name, exact: true })
    async function checkPresets() {
      for (const [id, swatch, group, size] of [
        ['draw', '蓝色', '粗细', '较粗'], ['text', '红色', '字号', '特大'], ['highlight', '黑色', '粗细', '较细'],
        ['rectangle', '绿色', '粗细', '最细'], ['ellipse', '绿色', '粗细', '最细'], ['arrow', '绿色', '粗细', '最细'],
      ]) {
        await selectTool(id).tap()
        await expect(selectTool(id)).toHaveAttribute('aria-pressed', 'true')
        await expect(color(swatch)).toHaveAttribute('aria-pressed', 'true')
        await expect(sizeButton(group, size)).toHaveAttribute('aria-pressed', 'true')
      }
      await selectTool('rectangle').tap()
      await moreStyle.tap()
      await expect(extra('fill-extra')).toHaveAttribute('data-isactive', 'true')
      await moreStyle.tap()
      await selectTool('text').tap()
      await moreStyle.tap()
      await expect(extra('font.serif')).toHaveAttribute('data-state', 'on')
      await expect(opacity).toHaveAttribute('aria-valuenow', '75')
      await moreStyle.tap()
      await selectTool('highlight').tap()
      await moreStyle.tap()
      await expect(opacity).toHaveAttribute('aria-valuenow', '100')
      await expect(extra('dash')).toHaveCount(0)
      await expect(extra('font')).toHaveCount(0)
      await moreStyle.tap()
      await selectTool('draw').tap()
      await moreStyle.tap()
      await expect(extra('dash.dashed')).toHaveAttribute('data-state', 'on')
      await expect(opacity).toHaveAttribute('aria-valuenow', '50')
      await moreStyle.tap()
    }

    for (const id of ['select', 'hand', 'draw', 'eraser', 'text', 'highlight', 'rectangle', 'ellipse', 'arrow']) {
      await expect(selectTool(id)).toBeVisible()
    }
    await expect(toolbar.getByTestId('toolbar.undo')).toBeDisabled()
    await expect(toolbar.getByTestId('toolbar.redo')).toBeDisabled()
    await expect(page.getByTestId('page-menu.button')).toHaveCount(0)
    await expect(styles).toHaveCount(0)
    await more.tap()
    const menu = page.getByRole('toolbar', { name: '更多工具', exact: true })
    for (const id of ['line', 'note', 'frame', 'asset', 'laser']) {
      await expect(menu.getByTestId('tools.more.' + id)).toBeAttached()
    }
    await expect(menu.getByTestId('tools.more.note')).toHaveAccessibleName(/便笺|Note/i)
    await expect(menu.getByTestId('tools.more.arrow')).toHaveCount(0)
    await menu.getByTestId('tools.more.line').tap()
    await expect(more).toHaveAttribute('data-isactive', 'true')
    await selectTool('ellipse').tap()
    await expect(selectTool('ellipse')).toHaveAttribute('aria-pressed', 'true')
    await selectTool('rectangle').tap()
    await expect(selectTool('rectangle')).toHaveAttribute('aria-pressed', 'true')
    await color('绿色').tap()
    await sizeButton('粗细', '最细').tap()
    await expect(extra('fill')).toHaveCount(0)
    await expect(opacity).toHaveCount(0)
    await moreStyle.tap()
    await expect(extra('fill').getByRole('radio')).toHaveCount(3)
    await expect(extra('dash').getByRole('radio')).toHaveCount(4)
    await expect(extra('color')).toHaveCount(0)
    await expect(extra('size')).toHaveCount(0)
    await extra('fill-extra').tap()
    await page.getByTestId('style.fill-extra.pattern').tap()
    await expect(extra('fill-extra')).toHaveAttribute('data-isactive', 'true')
    await moreStyle.tap()
    await selectTool('text').tap()
    await expect(controls('字号')).toBeVisible()
    await color('红色').tap()
    await sizeButton('字号', '特大').tap()
    await moreStyle.tap()
    await expect(extra('font').getByRole('radio')).toHaveCount(4)
    await extra('font.serif').tap()
    await expect(extra('font.serif')).toHaveAttribute('data-state', 'on')
    await expect(extra('fill')).toHaveCount(0)
    await opacity.press('End')
    await opacity.press('ArrowLeft')
    await moreStyle.tap()
    await selectTool('hand').tap()
    await expect(styles).toHaveCount(0)
    await selectTool('highlight').tap()
    await expect(selectTool('highlight')).toHaveAttribute('aria-pressed', 'true')
    await color('蓝色').tap()
    await color('黑色').tap()
    await sizeButton('粗细', '最粗').tap()
    await sizeButton('粗细', '较细').tap()
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
    await moreStyle.tap()
    await extra('dash.dashed').tap()
    await opacity.press('End')
    await opacity.press('ArrowLeft')
    await opacity.press('ArrowLeft')
    await moreStyle.tap()
    await checkPresets()
    await page.keyboard.press('a')
    await expect(selectTool('arrow')).toHaveAttribute('aria-pressed', 'true')
    await expect(color('绿色')).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('d')
    await expect(selectTool('draw')).toHaveAttribute('aria-pressed', 'true')
    await expect(color('蓝色')).toHaveAttribute('aria-pressed', 'true')
    const area = await canvas.boundingBox()
    const x = area.x + area.width * .45
    const y = area.y + area.height * .4
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 44, y + 9, { steps: 12 })
    await page.mouse.up()
    const strokes = () => page.evaluate(() => window.tlsync.store.allRecords().filter((r) => r.type === 'draw'))
    await expect.poll(async () => (await strokes()).map(({ props, opacity }) => [props.color, props.size, props.dash, opacity]))
      .toEqual([['blue', 'l', 'dashed', 0.5]])
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
    await toolbar.getByTestId('toolbar.undo').click()
    await expect.poll(async () => (await strokes())[0]?.props.color).toBe('blue')
    await toolbar.getByTestId('toolbar.redo').click()
    await expect.poll(async () => (await strokes())[0]?.props.color).toBe('red')
    await moreStyle.tap()
    await opacity.press('Home')
    await opacity.press('ArrowRight')
    await moreStyle.tap()
    await expect.poll(async () => {
      const [shape] = await strokes()
      return [shape?.props.color, shape?.opacity]
    }).toEqual(['red', 0.25])

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
    await checkPresets()
    // Dragging an arrow directly out of the toolbar while Draw is active uses Shape defaults.
    const arrow = await selectTool('arrow').boundingBox()
    await page.mouse.move(arrow.x + arrow.width / 2, arrow.y + arrow.height / 2)
    await page.mouse.down()
    await page.mouse.move(arrow.x, arrow.y - 130, { steps: 10 })
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => window.tlsync.store.allRecords()
      .filter((record) => record.type === 'arrow').map(({ props }) => [props.color, props.size]))).toEqual([['green', 's']])
    await more.tap()
    const triangle = await menu.getByTestId('tools.more.triangle').boundingBox()
    await page.mouse.move(triangle.x + triangle.width / 2, triangle.y + triangle.height / 2)
    await page.mouse.down()
    await page.mouse.move(triangle.x, triangle.y - 120, { steps: 10 })
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => window.tlsync.store.allRecords()
      .filter((record) => record.type === 'geo').map(({ props }) => [props.geo, props.color, props.size])))
      .toEqual([['triangle', 'green', 's']])
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
    await checkPresets()

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
    await expect(menu.getByTestId('tools.more.line')).toBeInViewport()
    const toolsGrid = await menu.boundingBox()
    expect(toolsGrid.x).toBeGreaterThanOrEqual(pane.x - 1)
    expect(toolsGrid.x + toolsGrid.width).toBeLessThanOrEqual(pane.x + pane.width + 1)
    await page.keyboard.press('Escape')
    await selectTool('text').tap()
    await moreStyle.tap()
    await expect(moreStyles).toBeVisible()
    const expanded = await moreStyles.boundingBox()
    expect(expanded.x).toBeGreaterThanOrEqual(pane.x - 1)
    expect(expanded.x + expanded.width).toBeLessThanOrEqual(pane.x + pane.width + 1)
    expect(errors).toEqual([])
    console.log('Native Card pickers, overflow tool drag, independent presets, color reordering and narrow layout passed.')
  } finally {
    await context.close()
  }
}


async function verifyPdfViewer(browser, origin) {
  const context = await browser.newContext({
    viewport: { width: 1480, height: 950 }, deviceScaleFactor: 2, hasTouch: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto(origin)
    await openGeneral(page)
    await waitEditor(page)
    await page.getByLabel('选择 PDF 文件').setInputFiles([
      { name: 'Other.pdf', mimeType: 'application/pdf', buffer: makePdf('Other', 48) },
      { name: 'Viewer.pdf', mimeType: 'application/pdf', buffer: makePdf('Sample phrase', 2, true) },
    ])
    const button = (name) => page.getByRole('button', { name, exact: true })
    const pageNumber = page.getByRole('textbox', { name: '页码' })
    const scroll = page.locator('.pdf-scroll')
    const second = scroll.locator('.page[data-page-number="2"]')
    const rendered = second.locator('.canvasWrapper canvas').first()
    async function go(number) {
      await pageNumber.fill(String(number))
      await pageNumber.press('Enter')
    }
    await expect(pageNumber).toHaveValue('1', timeout)
    const first = scroll.locator('.page[data-page-number="1"]')
    const text = first.locator('.textLayer').getByText('Sample phrase', { exact: true })
    await expect(text).toBeVisible(timeout)
    await text.evaluate(node => {
      const range = document.createRange()
      range.selectNodeContents(node)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
    })
    await page.keyboard.press('Control+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), timeout).toBe('Sample phrase')
    await button('查找 PDF 文字').click()
    await page.getByRole('searchbox', { name: 'PDF 搜索内容' }).fill('missing phrase')
    await expect(page.locator('.pdf-find-count')).toHaveText('无匹配', timeout)
    await page.getByRole('searchbox', { name: 'PDF 搜索内容' }).fill('Sample')
    await expect(page.locator('.pdf-find-count')).toHaveText('1 / 2', timeout)
    await expect(first.locator('.textLayer .highlight.selected')).toHaveText('Sample', timeout)
    await button('下一个匹配').click()
    await expect(page.locator('.pdf-find-count')).toHaveText('2 / 2', timeout)
    await expect(second.locator('.textLayer .highlight.selected')).toHaveText('Sample', timeout)
    await expect(pageNumber).toHaveValue('2')
    await button('上一个匹配').click()
    await expect(pageNumber).toHaveValue('1')
    await page.getByRole('searchbox').press('Escape')
    await expect(first.locator('.textLayer .highlight')).toHaveCount(0, timeout)
    await button('缩略图').click()
    const thumb = button('跳至第 2 页')
    await expect(thumb.locator('canvas')).toBeVisible(timeout)
    const thumbnail = await thumb.locator('canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height }))
    expect(thumbnail.width).toBeGreaterThan(thumbnail.height)
    await thumb.click()
    await expect(pageNumber).toHaveValue('2')
    await button('关闭侧栏').click()
    await go(1)
    await expect(pageNumber).toHaveValue('1')
    await button('大纲').click()
    await button('Second chapter').click()
    await expect(pageNumber).toHaveValue('2')
    await button('关闭侧栏').click()

    await button('顺时针旋转').click()
    await button('适应页面').click()
    await go(2)
    await expect(rendered).toBeVisible(timeout)
    await expect.poll(() => rendered.evaluate(canvas => canvas.height > canvas.width), timeout).toBe(true)
    const originalWidth = await rendered.evaluate(canvas => canvas.width)
    await button('放大').click()
    await expect.poll(() => rendered.evaluate(canvas => canvas.width), timeout).toBeGreaterThan(originalWidth)
    await button('适应宽度').click()
    await button('适应页面').click()
    await go(2)
    await expect(pageNumber).toHaveValue('2')
    await button('选区').click()
    async function selectArea(from, to) {
      const bounds = await second.locator('.canvasWrapper').boundingBox()
      await page.mouse.move(bounds.x + bounds.width * from[0], bounds.y + bounds.height * from[1])
      await page.mouse.down()
      await page.mouse.move(bounds.x + bounds.width * to[0], bounds.y + bounds.height * to[1], { steps: 8 })
      await page.mouse.up()
    }
    await selectArea([.25, .25], [.55, .42])
    await expect(page.locator('.pdf-region-outline')).toBeVisible()
    await button('创建 Card').click()
    await expect(cardButton(page, 2)).toHaveAttribute('aria-pressed', 'true')
    const { items } = await cardState(page)
    const ids = await getPdfs(page)
    const regionShape = () => page.evaluate(() => window.tlsync?.store.allRecords().filter(({ type }) => type === 'pdf-region') ?? [])
    await expect.poll(async () => (await regionShape()).length, timeout).toBe(1)
    const [selected] = await regionShape()
    expect(selected.props).toMatchObject({ pdfId: ids['Viewer.pdf'], pageNumber: 2, rotation: 180 })
    for (const [key, value] of Object.entries({ xMin: 275.4, xMax: 459, yMin: 198, yMax: 332.64 })) {
      expect(Math.abs(selected.props[key] - value)).toBeLessThan(4)
    }
    await expect(page.getByLabel('PDF 第 2 页选区')).toBeVisible(timeout)
    await expect(marker(page)).toHaveCount(1, timeout)
    await button('插入 PDF 选区').click()
    await selectArea([.42, .45], [.66, .53])
    await button('插入当前 Card').click()
    await expect.poll(async () => (await regionShape()).length, timeout).toBe(2)
    await expect(marker(page)).toHaveCount(2, timeout)
    expect((await cardState(page)).items.length).toBe(items.length)

    // Leave while the find controller still has work queued for the previous document.
    await button('查找 PDF 文字').click()
    await page.getByRole('searchbox', { name: 'PDF 搜索内容' }).fill('phrase')
    await selectPdf(page, 'Other')
    await expect(pageNumber).toHaveValue('1', timeout)
    await expect(page.locator('.pdf-find')).toHaveCount(0)
    await go(36)
    await expect(pageNumber).toHaveValue('36', timeout)
    await expect(scroll.locator('.page[data-page-number="36"] .canvasWrapper canvas').first()).toBeVisible(timeout)
    await scroll.hover()
    await page.mouse.wheel(0, 720)
    await expect(pageNumber).toHaveValue('37', timeout)
    expect(await scroll.locator('.canvasWrapper canvas').count()).toBeLessThan(18)
    await button('缩略图').click()
    const thumbnails = page.getByRole('complementary', { name: '页面缩略图' })
    await expect(thumbnails.getByRole('button', { name: '跳至第 37 页' })).toBeAttached()
    await thumbnails.getByRole('button', { name: '上一组页面' }).click()
    await expect(thumbnails.getByRole('button', { name: '跳至第 1 页' })).toBeVisible()
    await button('关闭侧栏').click()
    const inserted = (await regionShape()).find(({ id }) => id !== selected.id)
    await page.locator('[data-shape-id="' + inserted.id + '"]').click({ button: 'right', force: true })
    await page.getByText('跳转到 PDF 来源', { exact: true }).click()
    await expect(pdfButton(page, 'Viewer')).toHaveAttribute('aria-pressed', 'true')
    await expect(pageNumber).toHaveValue('2', timeout)
    const highlight = page.locator('.pdf-jump-highlight')
    await expect(highlight).toBeVisible(timeout)
    const jumpBounds = await highlight.boundingBox()
    const secondBounds = await second.locator('.canvasWrapper').boundingBox()
    expect(Math.abs((jumpBounds.x - secondBounds.x) / secondBounds.width - .42)).toBeLessThan(.015)
    expect(Math.abs((jumpBounds.y - secondBounds.y) / secondBounds.height - .45)).toBeLessThan(.015)

    const reading = async (name) => (await sessionsOf(page)).items.find(item => item.name === name).reading[ids['Viewer.pdf']]
    await expect.poll(async () => (await reading('General'))?.rotation, timeout).toBe(90)
    await expect.poll(async () => (await reading('General'))?.scale, timeout).toBe('page-fit')
    await editWorkspace(page, '新建工作区', 'Viewer review')
    await selectPdf(page, 'Viewer')
    await expect(pageNumber).toHaveValue('1', timeout)
    await expect.poll(async () => (await reading('Viewer review'))?.page, timeout).toBe(1)
    expect((await reading('Viewer review')).rotation).toBeUndefined()
    const menu = await manage(page)
    await menu.getByRole('button', { name: 'General', exact: true }).click()
    await expect(pageNumber).toHaveValue('2', timeout)
    await page.reload()
    await expect(pageNumber).toHaveValue('2', timeout)
    await expect.poll(() => rendered.evaluate(canvas => canvas.height > canvas.width), timeout).toBe(true)
    await expect(marker(page)).toHaveCount(2, timeout)
    await expect.poll(async () => (await regionShape()).map(({ props }) => props), timeout).toContainEqual(selected.props)

    const backup = path.join(scratch, 'pdf-viewer.zip')
    await download(page, backup)
    const restoredContext = await browser.newContext({ viewport: { width: 1480, height: 950 } })
    try {
      const restored = await restoredContext.newPage()
      await restored.goto(origin)
      await restore(restored, backup)
      await expect(restored.getByRole('textbox', { name: '页码' })).toHaveValue('2', timeout)
      await expect(marker(restored)).toHaveCount(2, timeout)
      const restoredView = (await sessionsOf(restored)).items.find(item => item.name === 'General').reading[ids['Viewer.pdf']]
      expect(restoredView).toMatchObject({ page: 2, rotation: 90, scale: 'page-fit' })
    } finally {
      await restoredContext.close()
    }

    await page.setViewportSize({ width: 390, height: 740 })
    await button('缩略图').tap()
    const pane = await page.locator('#pdf-pane').boundingBox()
    const sidebar = await page.getByRole('complementary', { name: '页面缩略图' }).boundingBox()
    expect(sidebar.x + sidebar.width).toBeLessThanOrEqual(pane.x + pane.width)
    await button('关闭侧栏').tap()
    expect(errors).toEqual([])
    console.log('PDFViewer passed text copy, search, thumbnails, outline, high-DPI zoom, bounded rendering with 48 pages, rotated selection, both Card actions, source jump, independent sessions, ZIP restore and touch.')
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
    await expect(workspaceMenu(page).getByText('PencilKit Test', { exact: true })).toHaveCount(0)
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
    await verifyIosSafeArea(browser, origin)
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
    await verifyPdfViewer(browser, origin)
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
