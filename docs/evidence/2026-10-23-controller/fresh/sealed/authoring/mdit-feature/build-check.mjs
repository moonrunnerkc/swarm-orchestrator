import { readFileSync, writeFileSync } from 'node:fs'
import { corpus } from './corpus.mjs'
const base = JSON.parse(readFileSync('base-expected.json', 'utf8'))
const ref = JSON.parse(readFileSync('ref-expected.json', 'utf8'))
const expected = {}
for (const k of Object.keys(base)) expected[k] = base[k].map((row, i) => ({ html: row.html, tokens: row.tokens, references: row.references, keptIndices: ref[k][i].keptIndices, keptDefs: ref[k][i].keptDefs }))
const text = readFileSync('check-template.mjs', 'utf8').replace('__EXPECTED__', JSON.stringify(expected)).replace('__CORPUS__', JSON.stringify(corpus, null, 2))
writeFileSync(process.argv[2], text)
