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
const BASE = {"modules":[{"path":"src/common/html_blocks.mjs","content":"5bbdf4ab71bd31461b29d47da1077c600ba941c3e53d74f8d50ce31ac45546a5","exports":["default"]},{"path":"src/common/html_re.mjs","content":"82021df92c9f3f856cd1bb59454c2033c50a0617a748acc150bbdacb8101abcc","exports":["HTML_OPEN_CLOSE_TAG_RE","HTML_TAG_RE"]},{"path":"src/common/utils.mjs","content":"b01fe8db2f5791df9c79896bb4aae8f581d4b551c050667a8cc3467acd4d2f36","exports":["arrayReplaceAt","asciiTrim","assign","callable","escapeHtml","escapeRE","fromCodePoint","has","isMdAsciiPunct","isPunctChar","isPunctCharCode","isSpace","isString","isValidEntityCode","isWhiteSpace","lib","normalizeReference","unescapeAll","unescapeMd"]},{"path":"src/helpers/index.mjs","content":"593d0777dfeb6ccd4aefd5581ce91fa7ca88cb2df595d9e4ce73c814f2a8b041","exports":["parseLinkDestination","parseLinkLabel","parseLinkTitle"]},{"path":"src/helpers/parse_link_destination.mjs","content":"d066f2112e994a2f1755d7d585dc1f50d14c2b229a53e54e341e7280391cb0fc","exports":["default"]},{"path":"src/helpers/parse_link_label.mjs","content":"70129adaa86dfd0f99e05971c51f865a3956775c045ccdc2ec8f2f2e0c0893aa","exports":["default"]},{"path":"src/helpers/parse_link_title.mjs","content":"eb2f601ad3c2c5db724f4efd36fa471030af953760e3cdcd1e62a1b0074ea027","exports":["default"]},{"path":"src/index.mjs","content":"b5d5b61171f8eb303f3ae805cc2ef57a648230e2cf5d186f5fc3cb6aa0e72495","exports":["default"]},{"path":"src/markdownit.mjs","content":"b4194e7de3fae4ee9a14003712ab4ee8b95fc0d4cc8e81d3dc55ef4ac41ee9de","exports":["default"]},{"path":"src/parser_block.mjs","content":"bcf8458b6bcc708c47a501516fc4291b3bf4509d94c344407ef12f3d2b6be40e","exports":["default"]},{"path":"src/parser_core.mjs","content":"b93fe04205b03cb5cd31e2503bc5701bad8f5fb5de9e7c32a889c7b1c469a854","exports":["default"]},{"path":"src/parser_inline.mjs","content":"cfc56e597f378968fbb6b4d0b59aaa4012a0993ecafd1704d1680fcef01684ac","exports":["default"]},{"path":"src/presets/commonmark.mjs","content":"0287ae7e457b4a18f049aa81a7ca39bbc543eb2e9b95718476a8fb16dc299eee","exports":["default"]},{"path":"src/presets/default.mjs","content":"f8b577995fcde6bd0fcb96524eb32a872d9e82874921956fda81477913a94cc9","exports":["default"]},{"path":"src/presets/zero.mjs","content":"d88083cd3b6a87566b63950c99a810fa3228345a41cb1fe441f2d8139bb9e60f","exports":["default"]},{"path":"src/renderer.mjs","content":"76faa1b5d34c44ff5f93bb0cc0caccafa2e5bbdc9cff25182f7cd9467d7c0bd5","exports":["default"]},{"path":"src/ruler.mjs","content":"d756481202e4e530115a19c5540a66987bcd16271b0a12236644179cf9910a46","exports":["default"]},{"path":"src/rules_block/blockquote.mjs","content":"61c459bd8ce00320f815a02d2f3d2ae5b9b9d47c9376930e007faaa83a3c7d9c","exports":["default"]},{"path":"src/rules_block/code.mjs","content":"5b5aad3b00bf175f55849ae44974944fc26a45d416440f3710d11c6213f49968","exports":["default"]},{"path":"src/rules_block/fence.mjs","content":"4434e2f70150df1490bd11eeea8bd20fe763f029c22fc21305b6376f068cfd21","exports":["default"]},{"path":"src/rules_block/heading.mjs","content":"7204a90c5428e7d67f95f60ed599a0cd0c14e5a5062b24d86c62f23b0754a487","exports":["default"]},{"path":"src/rules_block/hr.mjs","content":"f58496120ce4a9d18cbf4262d8ddcb609f11800c2324580806609e0df8c729c1","exports":["default"]},{"path":"src/rules_block/html_block.mjs","content":"00fe5498df1e3d7f209013c10d6aa0dba51443c7eb6ee01633618074deb9102e","exports":["default"]},{"path":"src/rules_block/lheading.mjs","content":"63b4e87f84d829bf12789790353fed242de01d1e324fdbb353292e5175862cab","exports":["default"]},{"path":"src/rules_block/list.mjs","content":"cc87a5c96762fef68ffc3ef4a04d22dc32d702f9305f8f1c1129282ec96d0328","exports":["default"]},{"path":"src/rules_block/paragraph.mjs","content":"800faf2fc565d13cc50ea8cdc2c4582ff556b8256f752b1d29fcea151915904d","exports":["default"]},{"path":"src/rules_block/reference.mjs","content":"036ce44f50874f3c439ba67be50839bbc26b2d42f6fce9df44822e41b9849e9a","exports":["default"]},{"path":"src/rules_block/state_block.mjs","content":"12e8e49894c6c734bd0b9fe7c7dba6d26972deedfc8545e180fc03999a633bc7","exports":["default"]},{"path":"src/rules_block/table.mjs","content":"eafe4168fccc76483f94ec198ccf0498a0dbb5371be910d8c5739b104d2f8df1","exports":["default"]},{"path":"src/rules_core/block.mjs","content":"52ef23be5d9248275a5c0ff8b43602540bd3ed8a69bc63fbdc262b09c5de69b5","exports":["default"]},{"path":"src/rules_core/inline.mjs","content":"0da70e72022dda01deaf6630a772a9c4798b6b6dc1d37144520b872d302b12a3","exports":["default"]},{"path":"src/rules_core/linkify.mjs","content":"6dc26cbea31efc93d23ff4bf40666c36139b9f0bac197adc0948d3e656210e07","exports":["default"]},{"path":"src/rules_core/normalize.mjs","content":"7f7fab952ebe0a0c16016835e1af0bf682af6e2eb5a28454eb350c28332cfa93","exports":["default"]},{"path":"src/rules_core/replacements.mjs","content":"9b3211580c89951bad60aa4550f76ebf2d2b81cc4523849ed34e6b85ed25ba3a","exports":["default"]},{"path":"src/rules_core/smartquotes.mjs","content":"d7c8c4cce94316a909fda4f9ed485e6366dd6faa97e9cb4912caf0eaa9152c61","exports":["default"]},{"path":"src/rules_core/state_core.mjs","content":"2b4b94989ed73b31aacec4dd9753675d04e29819c9dedfdc697f14e5f83490c9","exports":["default"]},{"path":"src/rules_core/text_join.mjs","content":"d61f0f19e2e49b565564a1537c46828c18da453516226d1637816021d4d68fce","exports":["default"]},{"path":"src/rules_inline/autolink.mjs","content":"78599ff3df236375e29dc63f04ad93ae1bb4744d7c47021b93104462cbfc61c5","exports":["default"]},{"path":"src/rules_inline/backticks.mjs","content":"8baed32815f895f72b0a01255c3180ba2e72fcffb51fbea7677ccf128dafbc40","exports":["default"]},{"path":"src/rules_inline/balance_pairs.mjs","content":"06769d0aa4e5af875e504dea82db9bc726b463911e7b1c17f732098be95ad403","exports":["default"]},{"path":"src/rules_inline/emphasis.mjs","content":"23e1dbd2fdb408e257f2bbccccae1b1ee8a068db1c43a38b4edd9db76c2f40a1","exports":["default"]},{"path":"src/rules_inline/entity.mjs","content":"1c23b59a35bf4775966be0f2d88772d0a2c54b5468a754d1d639531678545fb2","exports":["default"]},{"path":"src/rules_inline/escape.mjs","content":"cde1567a48880d133ba53d48cb09c6009a5bdc837eb25e23281877494d1ece80","exports":["default"]},{"path":"src/rules_inline/fragments_join.mjs","content":"143e477737ce7565af95a6c5dbb854667a07d45e7f3e1b849fb68ba39937014c","exports":["default"]},{"path":"src/rules_inline/html_inline.mjs","content":"61991ef0fb3bd1a33ea290188d903940eb923d90114aec78ca6830ab5b93d04a","exports":["default"]},{"path":"src/rules_inline/image.mjs","content":"96d0d4d9e6ba99fa402b3f42376745e1b4db3e6220d6e9d790f234ab85807af4","exports":["default"]},{"path":"src/rules_inline/link.mjs","content":"d30d20431195f05385f27b06a4c362aa0021a021ebc8686709dea72a05245fc7","exports":["default"]},{"path":"src/rules_inline/linkify.mjs","content":"3b90cbcfa7672a507729fc07555969fb59129aefcd4a6018ced4a715f3da99f6","exports":["default"]},{"path":"src/rules_inline/newline.mjs","content":"7279415d2998e75b57f85149e4b39041d4bd47b4d327ca66c2a69df23b718021","exports":["default"]},{"path":"src/rules_inline/state_inline.mjs","content":"28713fcd6f1ccc8ac1daf2bb836961cf6269c70d933a92a61eb4533663eb6199","exports":["default"]},{"path":"src/rules_inline/strikethrough.mjs","content":"cf130f8d2405731b5a2ed687ad7b4571baf9dbc3f98a472629c6553c1c6cb089","exports":["default"]},{"path":"src/rules_inline/text.mjs","content":"63aca7fc12c4e44bbe8edb6b8cf38c8bf01e3aa1ef5dd0feef82aae930b1d0e8","exports":["default"]},{"path":"src/token.mjs","content":"34d66cd4b52b4b377947d30a41736713445d706efe856b1ae2a91271fc453f84","exports":["default"]}],"renders":[["<h1>Title</h1>\n<p>Some <em>emphasis</em>, <strong>strong</strong>, <code>code</code> and <a href=\"http://example.com\" title=\"t\">a link</a>.</p>\n","<h1>Title</h1>\n<p>Some <em>emphasis</em>, <strong>strong</strong>, <code>code</code> and <a href=\"http://example.com\" title=\"t\">a link</a>.</p>\n","<h1>Title</h1>\n<p>Some <em>emphasis</em>, <strong>strong</strong>, <code>code</code> and <a href=\"http://example.com\" title=\"t\">a link</a>.</p>\n"],["<ul>\n<li>one</li>\n<li>two\n<ul>\n<li>nested</li>\n</ul>\n</li>\n</ul>\n<ol>\n<li>first</li>\n<li>second</li>\n</ol>\n","<ul>\n<li>one</li>\n<li>two\n<ul>\n<li>nested</li>\n</ul>\n</li>\n</ul>\n<ol>\n<li>first</li>\n<li>second</li>\n</ol>\n","<ul>\n<li>one</li>\n<li>two\n<ul>\n<li>nested</li>\n</ul>\n</li>\n</ul>\n<ol>\n<li>first</li>\n<li>second</li>\n</ol>\n"],["<blockquote>\n<p>quote</p>\n<blockquote>\n<p>nested quote</p>\n</blockquote>\n</blockquote>\n<hr>\n","<blockquote>\n<p>quote</p>\n<blockquote>\n<p>nested quote</p>\n</blockquote>\n</blockquote>\n<hr />\n","<blockquote>\n<p>quote</p>\n<blockquote>\n<p>nested quote</p>\n</blockquote>\n</blockquote>\n<hr>\n"],["<pre><code class=\"language-js\">const a = 1 &lt; 2\n</code></pre>\n<pre><code>indented code\n</code></pre>\n","<pre><code class=\"language-js\">const a = 1 &lt; 2\n</code></pre>\n<pre><code>indented code\n</code></pre>\n","<pre><code class=\"language-js\">const a = 1 &lt; 2\n</code></pre>\n<pre><code>indented code\n</code></pre>\n"],["<table>\n<thead>\n<tr>\n<th style=\"text-align:left\">a</th>\n<th style=\"text-align:right\">b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td style=\"text-align:left\">1</td>\n<td style=\"text-align:right\">2</td>\n</tr>\n</tbody>\n</table>\n","<p>| a | b |\n|:--|--:|\n| 1 | 2 |</p>\n","<table>\n<thead>\n<tr>\n<th style=\"text-align:left\">a</th>\n<th style=\"text-align:right\">b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td style=\"text-align:left\">1</td>\n<td style=\"text-align:right\">2</td>\n</tr>\n</tbody>\n</table>\n"],["<p><s>struck</s> and &quot;quotes&quot; -- dashes... (c) (tm)</p>\n","<p>~~struck~~ and &quot;quotes&quot; -- dashes... (c) (tm)</p>\n","<p><s>struck</s> and “quotes” – dashes… © ™</p>\n"],["<p>Visit https://example.org/path?x=1 or www.example.com today.</p>\n","<p>Visit https://example.org/path?x=1 or www.example.com today.</p>\n","<p>Visit <a href=\"https://example.org/path?x=1\">https://example.org/path?x=1</a> or www.example.com today.</p>\n"],["<p>&lt;div class=&quot;x&quot;&gt;\n<em>html block</em>\n&lt;/div&gt;</p>\n<p>inline &lt;span&gt;html&lt;/span&gt; &amp; © #</p>\n","<div class=\"x\">\n*html block*\n</div>\n<p>inline <span>html</span> &amp; © #</p>\n","<div class=\"x\">\n*html block*\n</div>\n<p>inline <span>html</span> &amp; © #</p>\n"],["<p><a href=\"/url\" title=\"Title\">ref</a> and <img src=\"/url\" alt=\"img\" title=\"Title\"></p>\n","<p><a href=\"/url\" title=\"Title\">ref</a> and <img src=\"/url\" alt=\"img\" title=\"Title\" /></p>\n","<p><a href=\"/url\" title=\"Title\">ref</a> and <img src=\"/url\" alt=\"img\" title=\"Title\"></p>\n"],["<p>line one<br>\nline two<br>\nline three</p>\n","<p>line one<br />\nline two<br />\nline three</p>\n","<p>line one<br>\nline two<br>\nline three</p>\n"],["<h1>Setext</h1>\n<h2>Sub</h2>\n","<h1>Setext</h1>\n<h2>Sub</h2>\n","<h1>Setext</h1>\n<h2>Sub</h2>\n"],["<ul>\n<li>[ ] task-like</li>\n<li>*escaped*</li>\n</ul>\n","<ul>\n<li>[ ] task-like</li>\n<li>*escaped*</li>\n</ul>\n","<ul>\n<li>[ ] task-like</li>\n<li>*escaped*</li>\n</ul>\n"]],"cli":"0ac48f306a1f58f09dcb50ba0293223fa728dbd9794fe59c9ae64a0b422f39f8"}
const corpus = [
  "# Title\n\nSome *emphasis*, **strong**, `code` and [a link](http://example.com \"t\").\n",
  "- one\n- two\n  - nested\n\n1. first\n2. second\n",
  "> quote\n> > nested quote\n\n---\n",
  "```js\nconst a = 1 < 2\n```\n\n    indented code\n",
  "| a | b |\n|:--|--:|\n| 1 | 2 |\n",
  "~~struck~~ and \"quotes\" -- dashes... (c) (tm)\n",
  "Visit https://example.org/path?x=1 or www.example.com today.\n",
  "<div class=\"x\">\n*html block*\n</div>\n\ninline <span>html</span> &amp; &copy; &#35;\n",
  "[ref] and ![img][ref]\n\n[ref]: /url \"Title\"\n",
  "line one  \nline two\\\nline three\n",
  "Setext\n======\n\nSub\n---\n",
  "* [ ] task-like\n* \\*escaped\\*\n"
]
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
