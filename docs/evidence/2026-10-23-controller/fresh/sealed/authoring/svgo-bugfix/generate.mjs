import { pathToFileURL } from 'node:url'
import { corpus } from './corpus.mjs'
const [checkout] = process.argv.slice(2)
const { optimize } = await import(pathToFileURL(`${checkout}/lib/svgo.js`).href)
console.log(JSON.stringify(corpus.map((svg) => { try { return optimize(svg, { plugins: ['removeScripts'] }).data } catch (e) { return `THROWS ${e.message}` } })))
