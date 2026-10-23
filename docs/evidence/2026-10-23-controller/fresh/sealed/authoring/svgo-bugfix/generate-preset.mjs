import { pathToFileURL } from 'node:url'
import { presetCorpus } from './preset-corpus.mjs'
const [checkout] = process.argv.slice(2)
const { optimize } = await import(pathToFileURL(`${checkout}/lib/svgo.js`).href)
console.log(JSON.stringify(presetCorpus.map((svg) => optimize(svg).data)))
