import { readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const [checkout] = process.argv.slice(2)
const { default: markdownit } = await import(pathToFileURL(`${checkout}/src/index.ts`).href)
const inputs = (text) => { const lines = text.split(/\r?\n/g); const out = []; let i = 0
  while (i < lines.length) { if (lines[i] !== '.') { i++; continue } const s = ++i; while (i < lines.length && lines[i] !== '.') i++; if (i >= lines.length) break; out.push(lines.slice(s, i).join('\n') + '\n'); i++; while (i < lines.length && lines[i] !== '.') i++; i++ }
  return out }
const files = ['test/fixtures/commonmark/good.txt', ...readdirSync(`${checkout}/test/fixtures/markdown-it`).map((f) => `test/fixtures/markdown-it/${f}`)]
let n = 0, bad = 0
for (const f of files) for (const src of inputs(readFileSync(`${checkout}/${f}`, 'utf8'))) {
  for (const make of [() => markdownit(), () => markdownit('commonmark'), () => markdownit({ html: true, linkify: true, typographer: true })]) {
    const a = make(); const b = make(); b.core.ruler.disable('strip_references'); n++
    if (a.render(src) !== b.render(src)) { bad++; if (bad < 5) console.log(f, JSON.stringify(src)) }
  }
}
console.log({ n, bad })
