// Prints, for one checkout, each corpus input's rendering, token projection and references per
// configuration: with --kept, also the stream with the stripping rule disabled.
//   node generate.mjs <checkout> [--kept]
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { corpus, configurations, project } from './corpus.mjs'
const [checkout, kept] = process.argv.slice(2)
const { default: markdownit } = await import(pathToFileURL(`${checkout}/src/index.ts`).href)
const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const out = {}
for (const c of configurations) {
  out[c.name] = corpus.map((src) => {
    const md = c.make(markdownit)
    const env = {}
    const tokens = md.parse(src, env)
    const row = { html: md.render(src), tokens: sha(project(tokens)), references: env.references ?? null }
    if (kept) {
      const k = c.make(markdownit)
      k.core.ruler.disable('strip_references')
      const kt = k.parse(src, {})
      row.keptHtml = k.render(src)
      row.kept = project(kt).filter((t) => t.type === 'reference_definition').map((t) => ({ ...t, index: project(kt).indexOf(t) }))
      row.keptIndices = kt.map((t, i) => t.type === 'reference_definition' ? i : -1).filter((i) => i >= 0)
      row.keptDefs = project(kt).filter((t) => t.type === 'reference_definition')
      row.keptRestDigest = sha(project(kt.filter((t) => t.type !== 'reference_definition')))
      delete row.kept
    }
    return row
  })
}
console.log(JSON.stringify(out))
