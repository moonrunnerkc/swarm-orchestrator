// Base facts for the rename evaluator: each src/**/*.mjs module, its normalized content digest
// and its export names, and renderings of a corpus through the source entry and the built dist.
//   node generate.mjs <base-checkout>   (dist built by the base's npm test)
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { corpus } from './corpus.mjs'
const [checkout] = process.argv.slice(2)
const normalize = (text) => text.replace(/\r\n?/g, '\n').replaceAll('.mjs', '.ts')
const sha = (t) => createHash('sha256').update(t).digest('hex')
const files = execFileSync('git', ['-C', checkout, 'ls-files', 'src'], { encoding: 'utf8' }).trim().split('\n').filter((p) => p.endsWith('.mjs'))
const modules = []
for (const path of files) {
  const ns = await import(pathToFileURL(`${checkout}/${path}`).href)
  modules.push({ path, content: sha(normalize(readFileSync(`${checkout}/${path}`, 'utf8'))), exports: Object.keys(ns).sort() })
}
const { default: src } = await import(pathToFileURL(`${checkout}/src/index.mjs`).href)
const { default: esm } = await import(pathToFileURL(`${checkout}/dist/markdown-it.mjs`).href)
const cjs = createRequire(import.meta.url)(`${checkout}/dist/markdown-it.cjs.js`)
const configs = [[], ['commonmark'], [{ html: true, linkify: true, typographer: true }]]
const renders = corpus.map((text) => configs.map((args) => {
  const a = src(...args).render(text)
  if (esm(...args).render(text) !== a || cjs(...args).render(text) !== a) throw new Error('dist disagrees at base')
  return a
}))
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
const dir = mkdtempSync(`${tmpdir()}/mdit-cli-`)
writeFileSync(`${dir}/input.md`, corpus.join('\n'))
const cli = sha(execFileSync(process.execPath, [`${checkout}/bin/markdown-it.mjs`, `${dir}/input.md`], { cwd: checkout, encoding: 'utf8' }))
console.log(JSON.stringify({ modules, renders, cli }))
