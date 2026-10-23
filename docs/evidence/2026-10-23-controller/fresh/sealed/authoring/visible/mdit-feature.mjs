import assert from 'node:assert/strict'
import markdownit from '../../src/index.ts'

const md = markdownit()
md.core.ruler.disable('strip_references')
const tokens = md.parse('[foo]: /url\n', {})
assert.equal(tokens.filter(token => token.type === 'reference_definition').length, 1)
console.log('visible check passed')
