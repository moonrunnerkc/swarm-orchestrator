import { readFileSync, writeFileSync } from 'node:fs'
import { corpus } from './corpus.mjs'
import { presetCorpus } from './preset-corpus.mjs'
const j = (f) => readFileSync(f, 'utf8').trim()
writeFileSync(process.argv[2], readFileSync('check-template.mjs', 'utf8')
  .replace('__CORPUS__', JSON.stringify(corpus, null, 2)).replace('__EXPECTED__', j('ref-out.json'))
  .replace('__PRESET_CORPUS__', JSON.stringify(presetCorpus, null, 2)).replace('__PRESET_EXPECTED__', j('ref-preset.json')))
