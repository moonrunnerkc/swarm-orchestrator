import { readFileSync } from 'node:fs'
import { corpus } from './corpus.mjs'
const b = JSON.parse(readFileSync(process.argv[2], 'utf8')), r = JSON.parse(readFileSync(process.argv[3], 'utf8'))
r.forEach((x, i) => console.log(i, b[i] === x ? 'SAME' : 'CHANGED', '\n  in :', corpus[i].replace(/<svg[^>]*>/, '').slice(0, 200), '\n  b  :', b[i].replace(/<svg[^>]*>/, '').slice(0, 200), '\n  r  :', x.replace(/<svg[^>]*>/, '').slice(0, 220)))
