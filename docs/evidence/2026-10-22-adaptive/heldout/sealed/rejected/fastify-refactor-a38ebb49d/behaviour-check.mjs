// Hidden behaviour check for the options-processing refactor: the structure the task names, the
// connection-closing contract of createServer, and fastify() behaviour that must not change
// (option validation and normalisation, logging, request ids, body limits, bad URLs, client
// errors, head routes). Runs from acceptance/hidden/ in the scoring checkout.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'

const require = createRequire(import.meta.url)
const root = new URL('../../', import.meta.url)
const fastify = require('../../fastify.js')
const { createServer } = require('../../lib/server.js')
const { kOptions } = require('../../lib/symbols.js')

const checks = []
const check = (name, body) => checks.push([name, body])
const source = (path) => readFileSync(new URL(path, root), 'utf8')
const throwsCode = (fn, code) => assert.throws(fn, (error) => error.code === code, `expected ${code}`)

check('structure: processOptions is a top-level function of fastify.js that fastify() calls', () => {
  const text = source('fastify.js')
  assert.ok(/^(?:function\s+processOptions\s*\(|(?:const|let)\s+processOptions\s*=)/m.test(text), 'fastify.js has no top-level processOptions')
  assert.ok((text.match(/processOptions\s*\(/g) ?? []).length >= 2, 'processOptions is declared but never called')
})

check('structure: defaultClientErrorHandler is a top-level function of fastify.js, not nested in fastify()', () => {
  const text = source('fastify.js')
  assert.ok(/^function\s+defaultClientErrorHandler\s*\(/m.test(text), 'fastify.js has no top-level defaultClientErrorHandler')
  assert.ok(!/^[ \t]+function\s+defaultClientErrorHandler\s*\(/m.test(text), 'a nested defaultClientErrorHandler remains')
})

check('structure: the router reads its logger from the options, not from a separate argument', () => {
  assert.ok(!/fastifyArgs\.logger/.test(source('lib/route.js')), 'lib/route.js still reads fastifyArgs.logger')
})

check('createServer: throws when idle closing is asked of a server that cannot close idle connections', () => {
  const server = { closeAllConnections () {} }
  throwsCode(() => createServer({ serverFactory: () => server, forceCloseConnections: 'idle' }, () => {}),
    'FST_ERR_FORCE_CLOSE_CONNECTIONS_IDLE_NOT_AVAILABLE')
})

check('createServer: resolves the closing policy and the connection tracking', () => {
  const noop = (result) => {
    const marker = {}
    result.keepAliveConnections.add(marker)
    return [...result.keepAliveConnections].length === 0 && !(result.keepAliveConnections instanceof Set)
  }
  const capable = { closeAllConnections () {}, closeIdleConnections () {} }
  const make = (server, forceCloseConnections) => createServer({ serverFactory: () => server, forceCloseConnections }, () => {})

  let result = make(capable, undefined)
  assert.equal(result.server, capable)
  assert.equal(typeof result.listen, 'function')
  assert.equal(result.forceCloseConnections, 'idle')
  assert.equal(result.serverHasCloseAllConnections, true)
  assert.equal(result.serverHasCloseHttp2Sessions, false)
  assert.ok(noop(result), 'default policy must not track connections')

  result = make(capable, 'idle')
  assert.equal(result.forceCloseConnections, 'idle')

  result = make({}, undefined)
  assert.equal(result.forceCloseConnections, false)
  assert.equal(result.serverHasCloseAllConnections, false)
  assert.ok(noop(result))

  result = make({}, true)
  assert.equal(result.forceCloseConnections, true)
  assert.ok(result.keepAliveConnections instanceof Set, 'true without closeAllConnections must track connections in a Set')
  assert.equal(result.keepAliveConnections.size, 0)

  result = make(capable, true)
  assert.equal(result.forceCloseConnections, true)
  assert.ok(noop(result), 'true with closeAllConnections must not track connections')

  result = make(capable, false)
  assert.equal(result.forceCloseConnections, false)
  assert.ok(noop(result))

  result = make({ closeHttp2Sessions () {} }, undefined)
  assert.equal(result.serverHasCloseHttp2Sessions, true)
})

check('normalised options carry the defaulted body limit', () => {
  assert.equal(fastify()[kOptions].bodyLimit, 1048576)
  assert.equal(fastify({ bodyLimit: 2048 })[kOptions].bodyLimit, 2048)
})

check('preserved: invalid options are rejected with the same errors', () => {
  throwsCode(() => fastify('nope'), 'FST_ERR_OPTIONS_NOT_OBJ')
  throwsCode(() => fastify({ querystringParser: 'nope' }), 'FST_ERR_QSP_NOT_FN')
  throwsCode(() => fastify({ routerOptions: { querystringParser: 1 } }), 'FST_ERR_QSP_NOT_FN')
  throwsCode(() => fastify({ schemaController: { bucket: 'nope' } }), 'FST_ERR_SCHEMA_CONTROLLER_BUCKET_OPT_NOT_FN')
  throwsCode(() => fastify({ ajv: { customOptions: [] } }), 'FST_ERR_AJV_CUSTOM_OPTIONS_OPT_NOT_OBJ')
  throwsCode(() => fastify({ ajv: { plugins: {} } }), 'FST_ERR_AJV_CUSTOM_OPTIONS_OPT_NOT_ARR')
  assert.throws(() => fastify({ bodyLimit: -5 }))
  throwsCode(() => fastify({ forceCloseConnections: 'idle', serverFactory: () => ({ on () {} }) }),
    'FST_ERR_FORCE_CLOSE_CONNECTIONS_IDLE_NOT_AVAILABLE')
})

check('preserved: the caller\'s options object is not mutated (it is copied shallowly)', () => {
  const options = { bodyLimit: 1000, requestIdHeader: 'X-Trace', logger: false, maxParamLength: 50 }
  const before = JSON.stringify(options)
  const app = fastify(options)
  assert.equal(JSON.stringify(options), before)
  assert.equal(app.initialConfig.bodyLimit, 1000)
})

check('preserved: initial config and request ids', async () => {
  const app = fastify({ requestIdHeader: 'X-Trace', requestIdLogLabel: 'trace' })
  assert.equal(app.initialConfig.requestIdHeader, 'x-trace')
  assert.equal(app.initialConfig.requestIdLogLabel, 'trace')
  assert.equal(fastify().initialConfig.requestIdLogLabel, 'reqId')
  assert.equal(fastify().initialConfig.bodyLimit, 1048576)
  app.get('/', (request, reply) => { reply.send({ id: request.id }) })
  const response = await app.inject({ url: '/', headers: { 'x-trace': 'abc-123' } })
  assert.equal(response.json().id, 'abc-123')
  const generated = fastify({ genReqId: () => 'fixed-id' })
  generated.get('/', (request, reply) => { reply.send({ id: request.id }) })
  assert.equal((await generated.inject('/')).json().id, 'fixed-id')
  await Promise.all([app.close(), generated.close()])
})

check('preserved: the body limit is enforced', async () => {
  const app = fastify({ bodyLimit: 10 })
  app.post('/', (request, reply) => { reply.send(request.body) })
  const tooLarge = await app.inject({ method: 'POST', url: '/', payload: { text: 'more than ten bytes' } })
  assert.equal(tooLarge.statusCode, 413)
  const small = await app.inject({ method: 'POST', url: '/', payload: { a: 1 } })
  assert.equal(small.statusCode, 200)
  await app.close()
})

check('preserved: request logging goes through the instance logger', async () => {
  const lines = []
  const stream = { write (line) { lines.push(JSON.parse(line)) } }
  const app = fastify({ logger: { level: 'info', stream } })
  app.get('/', (request, reply) => {
    request.log.info('inside handler')
    reply.send('ok')
  })
  const response = await app.inject('/')
  assert.equal(response.body, 'ok')
  const inside = lines.find((line) => line.msg === 'inside handler')
  const incoming = lines.find((line) => line.msg === 'incoming request')
  assert.ok(inside && incoming, `missing request log lines: ${JSON.stringify(lines.map((line) => line.msg))}`)
  assert.equal(inside.reqId, incoming.reqId)
  assert.ok(lines.some((line) => line.msg === 'request completed'))
  assert.equal(typeof app.log.info, 'function')

  const quiet = []
  const silentApp = fastify({ logger: { level: 'info', stream: { write (line) { quiet.push(JSON.parse(line)) } } }, disableRequestLogging: true })
  silentApp.get('/', (request, reply) => { request.log.info('only this'); reply.send('ok') })
  await silentApp.inject('/')
  assert.deepEqual(quiet.map((line) => line.msg), ['only this'])
  await Promise.all([app.close(), silentApp.close()])
})

check('preserved: bad URLs use frameworkErrors, or the default answer', async () => {
  const app = fastify({
    frameworkErrors (error, request, reply) {
      reply.code(400).send({ handled: error.code, hasLog: typeof request.log.info === 'function' })
    }
  })
  app.get('/:id', (request, reply) => { reply.send('ok') })
  const handled = await app.inject('/%c0')
  assert.equal(handled.statusCode, 400)
  assert.deepEqual(handled.json(), { handled: 'FST_ERR_BAD_URL', hasLog: true })
  const plain = fastify()
  plain.get('/:id', (request, reply) => { reply.send('ok') })
  const answered = await plain.inject('/%c0')
  assert.equal(answered.statusCode, 400)
  assert.equal(answered.json().code, 'FST_ERR_BAD_URL')
  await Promise.all([app.close(), plain.close()])
})

check('preserved: malformed requests get the default client error answer', async () => {
  const app = fastify()
  app.get('/', (request, reply) => { reply.send('ok') })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const { port } = app.server.address()
  const answer = await new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => { socket.write('NOT A REQUEST\r\n\r\n') })
    let text = ''
    socket.on('data', (chunk) => { text += chunk })
    socket.on('close', () => resolve(text))
    socket.on('error', reject)
  })
  assert.match(answer, /^HTTP\/1\.1 400 Bad Request/)
  assert.match(answer, /"message":"Client Error","statusCode":400/)
  await app.close()
})

check('preserved: head routes, timeouts and closing', async () => {
  const app = fastify({ connectionTimeout: 1234, keepAliveTimeout: 4321 })
  app.get('/', (request, reply) => { reply.send({ hello: 'world' }) })
  assert.equal((await app.inject({ method: 'HEAD', url: '/' })).statusCode, 200)
  assert.equal(app.initialConfig.connectionTimeout, 1234)
  assert.equal(app.initialConfig.keepAliveTimeout, 4321)
  await app.listen({ port: 0, host: '127.0.0.1' })
  assert.equal(app.server.keepAliveTimeout, 4321)
  await app.close()
  const noHead = fastify({ exposeHeadRoutes: false })
  noHead.get('/', (request, reply) => { reply.send('ok') })
  assert.equal((await noHead.inject({ method: 'HEAD', url: '/' })).statusCode, 404)
  await noHead.close()
})

let failed = 0
for (const [name, body] of checks) {
  let timer
  try {
    await Promise.race([body(), new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('timed out after 5000 ms')), 5000)
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
