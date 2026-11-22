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
const pdfButton = (page, name) => page.getByRole('button', { name: name + '.pdf', exact: true })
const cardButton = (page, number) => page.getByRole('button', { name: 'Card ' + number, exact: true })

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

function makePdf(label) {
  const stream = '0.0 0.4 0.7 rg 40 650 110 110 re f\nBT /F1 18 Tf 100 600 Td (' + label + ') Tj ET'
  const parts = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream',
  ]
  const offsets = []
  let pdf = '%PDF-1.4\n'
  for (const [index, part] of parts.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += (index + 1) + ' 0 obj\n' + part + '\nendobj\n'
  }
  const xref = Buffer.byteLength(pdf)
  pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')
  return Buffer.from(pdf + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n')
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
    const req = indexedDB.open('cardinal-notes:pdfs')
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
    await waitEditor(page)
    await page.locator('.pdf-bar input').setInputFiles([
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
    await pdfButton(page, 'Alpha').click()
    await expect(marker(page)).toHaveCount(2, timeout)
    const oldZip = path.join(scratch, 'old.zip')
    const newZip = path.join(scratch, 'new.zip')
    await download(page, oldZip)
    console.log('Two Cards, two PDFs, three region shapes and an image exported as ZIP v1.')

    dist = newDist
    await page.reload()
    await waitEditor(page, second.persistenceKey)
    await expect(marker(page)).toHaveCount(2, timeout)
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.length, cachePrefix + first.persistenceKey), timeout).toBe(2)
    await page.reload()
    await waitEditor(page, second.persistenceKey)
    await expect(marker(page)).toHaveCount(2, timeout)
    expect(await page.evaluate(() => window.shapeReads)).not.toContain('TLDRAW_DOCUMENT_v2' + first.persistenceKey)
    await pdfButton(page, 'Beta').click()
    await expect(marker(page)).toHaveCount(1, timeout)
    await marker(page).getByRole('button').click()
    await waitEditor(page, first.persistenceKey)
    await expectImage(page)
    await cardButton(page, 2).click()
    await waitEditor(page, second.persistenceKey)
    await pdfButton(page, 'Alpha').click()
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
    await page.evaluate(() => sessionStorage.removeItem('test-failed-shape-read'))
    await expect(marker(page)).toHaveCount(2, timeout)
    await expect(page.getByText('部分 PDF 引用尚未确认。')).toHaveCount(0)
    console.log('Inactive references work; valid indexes skip reads, and missing or malformed indexes rebuild after errors.')

    const peer = await context.newPage()
    await peer.goto(origin)
    await cardButton(peer, 1).click()
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
    await waitEditor(restored)
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
    await pdfButton(restored, 'Beta').click()
    await expect(marker(restored)).toHaveCount(1, timeout)
    await restored.waitForFunction(() => window.tlsync?.diffQueue.length === 0 && !window.tlsync.isPersisting)
    await restored.reload()
    await expect(marker(restored)).toHaveCount(1, timeout)
    await expectImage(restored)
    expect(await restored.evaluate(() => window.tlsync.store.get('shape:photo').x)).toBe(390)
    await download(restored, newZip)
    console.log('Existing v1 ZIP restored into a blank context; IDs, both PDF links, image bytes and reload were verified.')

    const clean = await browser.newContext({ viewport: { width: 1480, height: 950 } })
    const imported = await clean.newPage()
    await imported.goto(origin)
    await waitEditor(imported)
    await restore(imported, newZip)
    await expectImage(imported)
    await expect(marker(imported)).toHaveCount(1, timeout)
    expect(await imported.evaluate(() => ({
      imageX: window.tlsync.store.get('shape:photo').x,
      zoom: window.tlsync.store.allRecords().find(record => record.typeName === 'camera').z,
    }))).toEqual({ imageX: 390, zoom: 0.95 })
    const pointer = await imported.evaluate(() => localStorage.getItem('cardinal-notes:active-dataset'))
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
    await pdfButton(imported, 'Alpha').click()
    await expect(marker(imported)).toHaveCount(2, timeout)
    imported.once('dialog', dialog => dialog.accept())
    await imported.getByRole('button', { name: '删除 Card 1', exact: true }).click()
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
