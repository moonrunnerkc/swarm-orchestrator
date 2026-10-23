// Hidden behaviour check: reference definition tokens and their default stripping.
// Written into the scoring checkout at acceptance/hidden/ only at scoring time.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import markdownit from '../../src/index.ts'

const root = new URL('../../', import.meta.url)
const EXPECTED = __EXPECTED__
const corpus = __CORPUS__
const configurations = [
  { name: 'default', make: () => markdownit() },
  { name: 'commonmark', make: () => markdownit('commonmark') },
  { name: 'zero', make: () => markdownit('zero').enable(['reference', 'list', 'blockquote', 'heading', 'fence']) },
  { name: 'typographer', make: () => markdownit({ linkify: true, typographer: true, breaks: true, xhtmlOut: true }) }
]
const project = (tokens) => tokens.map((t) => t.type === 'reference_definition'
  ? { type: t.type, tag: t.tag, nesting: t.nesting, level: t.level, map: t.map, block: t.block, hidden: t.hidden, label: t.meta && t.meta.label }
  : { type: t.type, tag: t.tag, nesting: t.nesting, level: t.level, map: t.map, content: t.content, markup: t.markup, info: t.info, block: t.block, hidden: t.hidden, attrs: t.attrs, meta: t.meta, children: t.children && project(t.children) })
const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const plain = (v) => JSON.parse(JSON.stringify(v ?? null))

const failures = []
const check = (name, fn) => {
  try { fn() } catch (error) { failures.push(`${name}: ${String(error && error.message).split('\n').slice(0, 6).join(' | ')}`) }
}

for (const configuration of configurations) {
  corpus.forEach((src, i) => {
    const want = EXPECTED[configuration.name][i]
    const label = `${configuration.name} #${i} ${JSON.stringify(src).slice(0, 50)}`
    check(`default stream unchanged, ${label}`, () => {
      const md = configuration.make()
      const env = {}
      const tokens = md.parse(src, env)
      assert.equal(tokens.filter((t) => t.type === 'reference_definition').length, 0, 'reference_definition tokens are in the default stream')
      assert.equal(sha(project(tokens)), want.tokens, 'the default token stream differs from the existing one')
      assert.deepEqual(plain(env.references), plain(want.references), 'env.references differs')
      assert.equal(md.render(src), want.html, 'the default rendering differs')
    })
    check(`definitions kept when the rule is disabled, ${label}`, () => {
      const md = configuration.make()
      assert.deepEqual(md.core.ruler.disable('strip_references'), ['strip_references'])
      const env = {}
      const tokens = md.parse(src, env)
      const defs = tokens.map((t, index) => ({ t, index })).filter(({ t }) => t.type === 'reference_definition')
      assert.deepEqual(defs.map(({ index }) => index), want.keptIndices, 'definition tokens are not where the definitions were')
      assert.deepEqual(plain(project(defs.map(({ t }) => t))), plain(want.keptDefs), 'definition token fields differ')
      for (const { t } of defs) assert.equal(Object.getPrototypeOf(t.meta), null, 'a definition token meta has a prototype')
      assert.equal(sha(project(tokens.filter((t) => t.type !== 'reference_definition'))), want.tokens, 'the other tokens differ from the default stream')
      assert.deepEqual(plain(env.references), plain(want.references), 'env.references differs with the rule disabled')
      assert.equal(md.render(src), want.html, 'rendering with definition tokens kept differs from the default rendering')
      assert.equal(md.renderer.render(tokens, md.options, env), want.html, 'rendering the kept stream differs')
    })
  })
  check(`${configuration.name}: the rule runs right after block and before inline`, () => {
    const md = configuration.make()
    const seen = {}
    md.core.ruler.after('block', 'probe_after_block', (state) => { seen.afterBlock = state.tokens.some((t) => t.type === 'reference_definition') })
    md.core.ruler.before('inline', 'probe_before_inline', (state) => { seen.beforeInline = state.tokens.some((t) => t.type === 'reference_definition') })
    md.parse('[foo]: /url\n\nx', {})
    assert.equal(seen.afterBlock, true, 'a rule inserted right after block does not see the definition token')
    assert.equal(seen.beforeInline, false, 'a rule inserted right before inline still sees the definition token')
  })
}

check('MarkdownIt#disable and #enable reach the rule', () => {
  const md = markdownit()
  md.disable('strip_references')
  assert.equal(md.parse('[a]: /a', {}).filter((t) => t.type === 'reference_definition').length, 1)
  md.enable('strip_references')
  assert.equal(md.parse('[a]: /a', {}).filter((t) => t.type === 'reference_definition').length, 0)
})

check('disabling the rule on one instance leaves another alone', () => {
  const one = markdownit()
  one.core.ruler.disable('strip_references')
  const other = markdownit()
  assert.equal(other.parse('[a]: /a', {}).filter((t) => t.type === 'reference_definition').length, 0)
  assert.equal(one.parse('[a]: /a', {}).filter((t) => t.type === 'reference_definition').length, 1)
})

check('rendering the project fixtures with definition tokens kept is unchanged', () => {
  const inputs = (text) => {
    const lines = text.split(/\r?\n/g)
    const out = []
    let i = 0
    while (i < lines.length) {
      if (lines[i] !== '.') { i++; continue }
      const start = ++i
      while (i < lines.length && lines[i] !== '.') i++
      if (i >= lines.length) break
      out.push(lines.slice(start, i).join('\n') + '\n')
      i++
      while (i < lines.length && lines[i] !== '.') i++
      i++
    }
    return out
  }
  const directory = new URL('test/fixtures/markdown-it/', root)
  const files = [new URL('test/fixtures/commonmark/good.txt', root), ...(existsSync(directory) ? readdirSync(directory).map((f) => new URL(f, directory)) : [])]
  let count = 0
  const differing = []
  for (const file of files) {
    for (const src of inputs(readFileSync(file, 'utf8'))) {
      for (const make of [() => markdownit(), () => markdownit('commonmark'), () => markdownit({ html: true, linkify: true, typographer: true })]) {
        const a = make()
        const b = make()
        b.core.ruler.disable('strip_references')
        count++
        if (a.render(src) !== b.render(src)) differing.push(JSON.stringify(src).slice(0, 60))
      }
    }
  }
  assert.ok(count >= 2400, `only ${count} fixture renderings were read`)
  assert.deepEqual(differing.slice(0, 5), [])
})

if (failures.length > 0) {
  console.error(`${failures.length} behaviour check(s) failed:`)
  for (const failure of failures.slice(0, 40)) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('behaviour check passed')
