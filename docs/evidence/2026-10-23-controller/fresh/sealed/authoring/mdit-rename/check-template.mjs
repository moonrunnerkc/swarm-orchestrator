// Hidden behaviour check: src/**/*.mjs renamed to .ts with every reference updated.
// Written into the scoring checkout at acceptance/hidden/ only at scoring time, after npm test.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(join(root, 'package.json'))
const BASE = __FACTS__
const corpus = __CORPUS__
const configs = [[], ['commonmark'], [{ html: true, linkify: true, typographer: true }]]
const normalize = (text) => text.replace(/\r\n?/g, '\n').replaceAll('.mjs', '.ts')
const sha = (t) => createHash('sha256').update(t).digest('hex')

const failures = []
const check = async (name, fn) => {
  try { await fn() } catch (error) { failures.push(`${name}: ${String(error && error.message).split('\n').slice(0, 4).join(' | ')}`) }
}

for (const module of BASE.modules) {
  const renamed = module.path.replace(/\.mjs$/, '.ts')
  await check(`${module.path} -> ${renamed}`, async () => {
    assert.ok(!existsSync(join(root, module.path)), `${module.path} still exists`)
    assert.ok(existsSync(join(root, renamed)), `${renamed} is missing`)
    assert.equal(sha(normalize(readFileSync(join(root, renamed), 'utf8'))), module.content, `${renamed} differs from ${module.path} beyond its module paths`)
    const ns = await import(pathToFileURL(join(root, renamed)).href)
    assert.deepEqual(Object.keys(ns).sort(), module.exports, `${renamed} does not export exactly what ${module.path} exported`)
  })
}

const walk = (directory, skip) => {
  const out = []
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    const rel = relative(root, path).split('\\').join('/')
    if (skip.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) continue
    if (statSync(path).isDirectory()) out.push(...walk(path, skip))
    else out.push(rel)
  }
  return out
}

await check('no .mjs module is left under src/', async () => {
  assert.deepEqual(walk(join(root, 'src'), []).filter((path) => /\.mjs$/.test(path)), [])
})

await check('every relative import, export-from and require resolves to an existing file', async () => {
  const ts = require('typescript')
  const skip = ['node_modules', '.git', 'dist', 'acceptance', 'benchmark/extra', 'demo', 'apidoc', 'coverage']
  const code = walk(root, skip).filter((path) => /\.(mjs|cjs|js|ts|mts|cts)$/.test(path) && !/\.d\.[cm]?ts$/.test(path))
  assert.ok(code.length > 60, `only ${code.length} code files found`)
  const broken = []
  for (const path of code) {
    const text = readFileSync(join(root, path), 'utf8')
    const kind = /\.[cm]?ts$/.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind)
    const isTest = /^test\//.test(path)
    const specifiers = []
    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text)
      } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
        const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword
        const required = ts.isIdentifier(node.expression) && node.expression.text === 'require'
        // A test file's dynamic import is exercised by running that test, not judged here.
        if (required || (dynamic && !isTest)) specifiers.push(node.arguments[0].text)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) continue
      // A bundler query (`?raw`) is not part of the path; installed dependencies are not project files.
      const target = resolve(dirname(join(root, path)), specifier.replace(/[?#].*$/, ''))
      if (target.split(/[\\/]/).includes('node_modules')) continue
      const resolves = existsSync(target) && (!statSync(target).isDirectory() || existsSync(join(target, 'package.json')))
      if (!resolves) broken.push(`${path} -> ${specifier}`)
    }
  }
  assert.deepEqual(broken.slice(0, 12), [])
})

const expectRenders = (label, markdownit) => {
  corpus.forEach((text, i) => configs.forEach((args, j) => {
    assert.equal(markdownit(...args).render(text), BASE.renders[i][j], `${label} renders corpus #${i} with config #${j} differently`)
  }))
}

await check('src/index.ts behaves as src/index.mjs did', async () => {
  const { default: markdownit } = await import(pathToFileURL(join(root, 'src/index.ts')).href)
  expectRenders('src/index.ts', markdownit)
})

await check('importing the source entry prints nothing', async () => {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', "import md from './src/index.ts'; process.stdout.write(md().render('*x*'))"], { cwd: root, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout, '<p><em>x</em></p>\n')
  assert.equal(run.stderr, '', 'Node prints a warning when the renamed sources load')
})

await check('the build still produces working ESM and CommonJS bundles', async () => {
  const { default: esm } = await import(pathToFileURL(join(root, 'dist/markdown-it.mjs')).href)
  expectRenders('dist/markdown-it.mjs', esm)
  expectRenders('dist/markdown-it.cjs.js', require(join(root, 'dist/markdown-it.cjs.js')))
})

await check('the command line renders as before', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mdit-cli-'))
  const input = join(directory, 'input.md')
  writeFileSync(input, corpus.join('\n'))
  const out = execFileSync(process.execPath, [join(root, 'bin/markdown-it.mjs'), input], { cwd: root, encoding: 'utf8' })
  assert.equal(sha(out), BASE.cli, 'bin/markdown-it.mjs prints something else')
})

if (failures.length > 0) {
  console.error(`${failures.length} behaviour check(s) failed:`)
  for (const failure of failures.slice(0, 40)) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('behaviour check passed')
