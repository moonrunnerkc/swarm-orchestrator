import { readFileSync, writeFileSync } from 'node:fs'
import { corpus } from './corpus.mjs'
const facts = readFileSync('base-facts.json', 'utf8').trim()
writeFileSync(process.argv[2], readFileSync('check-template.mjs', 'utf8').replace('__FACTS__', facts).replace('__CORPUS__', JSON.stringify(corpus, null, 2)))
