// Hidden behaviour check for the kebab-case rename: every file the task names exists only under
// its new name, nothing in the code, types, tests, build script or configuration still points at
// an old name, each moved module exports what it exported before, the validator build writes the
// new file, and fastify behaves as before through the moved modules. Runs from acceptance/hidden/.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../', import.meta.url))
const checks = []
const check = (name, body) => checks.push([name, body])

const renames = {
  'lib/configValidator.js': 'lib/config-validator.js',
  'lib/contentTypeParser.js': 'lib/content-type-parser.js',
  'lib/fourOhFour.js': 'lib/four-oh-four.js',
  'lib/handleRequest.js': 'lib/handle-request.js',
  'lib/headRoute.js': 'lib/head-route.js',
  'lib/initialConfigValidation.js': 'lib/initial-config-validation.js',
  'lib/pluginOverride.js': 'lib/plugin-override.js',
  'lib/pluginUtils.js': 'lib/plugin-utils.js',
  'lib/reqIdGenFactory.js': 'lib/req-id-gen-factory.js',
  'lib/wrapThenable.js': 'lib/wrap-thenable.js',
  'types/serverFactory.d.ts': 'types/server-factory.d.ts'
}
const oldNames = Object.keys(renames).map((path) => path.split('/').pop().replace(/\.(d\.ts|js)$/, ''))
const alternation = oldNames.join('|')

// The export shape of each module at the base, by its old name.
const shapes = {
  'lib/configValidator.js': { type: 'function', keys: ['default', 'defaultInitOptions'], symbols: [] },
  'lib/contentTypeParser.js': { type: 'function', keys: ['defaultParsers', 'helpers'], symbols: ['Symbol(fastify.testInternals)'] },
  'lib/fourOhFour.js': { type: 'function', keys: [], symbols: [] },
  'lib/handleRequest.js': { type: 'function', keys: [], symbols: ['Symbol(internals)'] },
  'lib/headRoute.js': { type: 'object', keys: ['parseHeadOnSendHandlers'], symbols: [] },
  'lib/initialConfigValidation.js': { type: 'function', keys: ['defaultInitOptions', 'utils'], symbols: [] },
  'lib/pluginOverride.js': { type: 'function', keys: [], symbols: [] },
  'lib/pluginUtils.js': { type: 'object', keys: ['getDisplayName', 'getFuncPreview', 'getPluginName', 'kRegisteredPlugins', 'registerPlugin'], symbols: ['Symbol(fastify.testInternals)'] },
  'lib/reqIdGenFactory.js': { type: 'object', keys: ['getGenReqId', 'reqIdGenFactory'], symbols: [] },
  'lib/wrapThenable.js': { type: 'function', keys: [], symbols: [] }
}

const walk = (directory, pattern) => {
  const found = []
  if (!existsSync(join(root, directory))) return found
  for (const entry of readdirSync(join(root, directory))) {
    const relative = join(directory, entry)
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    if (statSync(join(root, relative)).isDirectory()) found.push(...walk(relative, pattern))
    else if (pattern.test(entry)) found.push(relative)
  }
  return found
}

check('every renamed file exists under its new name and not under its old one', () => {
  const problems = []
  for (const after of Object.values(renames)) {
    if (!existsSync(join(root, after))) problems.push(`${after} is missing`)
  }
  // Old names are found by listing the directories, so the file system's case rules do not matter.
  for (const directory of ['lib', 'types']) {
    for (const entry of readdirSync(join(root, directory))) {
      if (oldNames.some((name) => entry.startsWith(`${name}.`))) problems.push(`${directory}/${entry} still exists`)
    }
  }
  assert.deepEqual(problems, [])
})

check('nothing still points at an old file name', () => {
  const files = [
    'fastify.js', 'fastify.d.ts', 'eslint.config.js', 'package.json',
    ...walk('lib', /\.js$/), ...walk('types', /\.ts$/), ...walk('build', /\.js$/), ...walk('test', /\.(c|m)?(j|t)s$/)
  ].filter((path) => existsSync(join(root, path)))
  const patterns = [
    new RegExp(`(?:require|import|proxyquire)\\s*\\(\\s*['"][^'"]*\\b(?:${alternation})(?:\\.js|\\.d\\.ts)?['"]`),
    new RegExp(`from\\s+['"][^'"]*\\b(?:${alternation})(?:\\.js)?['"]`),
    new RegExp(`['"]\\./(?:${alternation})(?:\\.js)?['"]\\s*:`),
    new RegExp(`['"](?:lib/|types/)?(?:${alternation})\\.(?:js|d\\.ts)['"]`),
    new RegExp(`lib/(?:${alternation})\\.js`)
  ]
  const hits = []
  for (const path of files) {
    const lines = readFileSync(join(root, path), 'utf8').split('\n')
    lines.forEach((line, index) => {
      if (patterns.some((pattern) => pattern.test(line))) hits.push(`${path}:${index + 1}: ${line.trim()}`)
    })
  }
  assert.deepEqual(hits, [])
})

check('each moved module exports what it exported under its old name', () => {
  for (const [before, shape] of Object.entries(shapes)) {
    const moved = require(join(root, renames[before]))
    assert.equal(typeof moved, shape.type, renames[before])
    assert.deepEqual(Object.keys(moved).sort(), shape.keys, renames[before])
    assert.deepEqual(Object.getOwnPropertySymbols(moved).map(String), shape.symbols, renames[before])
  }
})

check('the type declarations resolve the server factory types from the new file', () => {
  const declarations = readFileSync(join(root, 'fastify.d.ts'), 'utf8')
  assert.ok(/from\s+['"]\.\/types\/server-factory['"]/.test(declarations), 'fastify.d.ts does not import ./types/server-factory')
  const factory = readFileSync(join(root, 'types/server-factory.d.ts'), 'utf8')
  assert.ok(/FastifyServerFactory\b/.test(factory) && /FastifyServerFactoryHandler\b/.test(factory))
})

check('the validator build writes the renamed file, with the same content', () => {
  const target = join(root, 'lib/config-validator.js')
  const normalise = (text) => text.replace(/\s+/g, '')
  const before = readFileSync(target, 'utf8')
  execFileSync(process.execPath, ['build/build-validation.js'], { cwd: root, stdio: 'pipe' })
  assert.equal(normalise(readFileSync(target, 'utf8')), normalise(before))
  assert.ok(!existsSync(join(root, 'lib/configValidator.js')), 'the build wrote lib/configValidator.js')
})

check('preserved: fastify behaves as before through the moved modules', async () => {
  const fastify = require(join(root, 'fastify.js'))
  assert.throws(() => fastify({ connectionTimeout: 'soon' }), (error) => error.code === 'FST_ERR_INIT_OPTS_INVALID')
  const app = fastify({ requestIdHeader: 'x-trace' })
  assert.ok(Object.isFrozen(app.initialConfig))
  app.addContentTypeParser('text/csv', { parseAs: 'string' }, (request, body, done) => { done(null, body.split(',')) })
  app.register(async function child (instance) {
    instance.decorate('scoped', true)
    instance.get('/scoped', async () => ({ scoped: instance.scoped }))
  })
  const shared = async function shared (instance) { instance.decorate('shared', 'yes') }
  shared[Symbol.for('skip-override')] = true
  app.register(shared)
  app.get('/', async (request) => ({ id: request.id, shared: app.shared }))
  app.post('/csv', (request, reply) => { reply.send(request.body) })
  app.get('/thenable', () => ({ then (resolve) { resolve({ via: 'thenable' }) } }))
  app.setNotFoundHandler((request, reply) => { reply.code(404).send({ missing: request.url }) })
  await app.ready()
  assert.equal(app.scoped, undefined)
  assert.deepEqual((await app.inject({ url: '/', headers: { 'x-trace': 'abc' } })).json(), { id: 'abc', shared: 'yes' })
  assert.deepEqual((await app.inject('/scoped')).json(), { scoped: true })
  assert.deepEqual((await app.inject({ method: 'POST', url: '/csv', headers: { 'content-type': 'text/csv' }, payload: 'a,b,c' })).json(), ['a', 'b', 'c'])
  assert.deepEqual((await app.inject('/thenable')).json(), { via: 'thenable' })
  const head = await app.inject({ method: 'HEAD', url: '/' })
  assert.equal(head.statusCode, 200)
  assert.equal(head.body, '')
  const missing = await app.inject('/nowhere')
  assert.equal(missing.statusCode, 404)
  assert.deepEqual(missing.json(), { missing: '/nowhere' })
  await app.close()
})

let failed = 0
for (const [name, body] of checks) {
  let timer
  try {
    await Promise.race([body(), new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('timed out after 10000 ms')), 10000)
    })])
    console.log(`ok - ${name}`)
  } catch (error) {
    failed++
    console.log(`not ok - ${name}\n${error?.stack ?? error}`)
  } finally {
    clearTimeout(timer)
  }
}
console.log(`${checks.length - failed}/${checks.length} behaviour checks passed`)
process.exitCode = failed === 0 ? 0 : 1
