import { cp, mkdir } from 'node:fs/promises'

const source = new URL('../node_modules/pdfjs-dist/', import.meta.url)
const destination = new URL('../public/pdf-assets/', import.meta.url)

await mkdir(destination, { recursive: true })
for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs', 'LICENSE']) {
  await cp(new URL(name, source), new URL(name, destination), { recursive: true })
}
