import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import markdownit from '../../src/index.ts'

assert.equal(markdownit().render('*x*'), '<p><em>x</em></p>\n')
assert.equal(existsSync(new URL('../../src/renderer.ts', import.meta.url)), true)
console.log('visible check passed')
