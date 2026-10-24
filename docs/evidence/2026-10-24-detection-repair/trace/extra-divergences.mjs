// Compares the delivered filterQuery with the reference patch's filterQuery on inputs outside the
// hidden check's three failing cases, to list divergences no check in the study measured.
// Usage: node extra-divergences.mjs <delivered-checkout> <reference-checkout> <jiti-dir>
import { pathToFileURL } from "node:url";
const [delivered, reference, jitiDir] = process.argv.slice(2);
const { createJiti } = await import(pathToFileURL(`${jitiDir}/lib/jiti.mjs`).href);
const load = (dir) => createJiti(pathToFileURL(`${dir}/`).href).import(`${dir}/src/index.ts`);
const d = await load(delivered);
const r = await load(reference);
const cases = [
  ["/foo?bar=1#frag", () => false],
  ["/foo?bar=1&baz=2#h", () => false],
  ["?bar=1", () => false],
  ["/foo#h?bar=1", () => false],
  ["/foo#h?bar=1", (k) => k === "bar"],
  ["HTTP://Example.com/p?a=1", () => true],
  ["file:///C:/x?bar=1&k=v", () => true],
];
for (const [input, pred] of cases) {
  const callsD = []; const callsR = [];
  const outD = d.filterQuery(input, (k, v) => { callsD.push(k); return pred(k, v); });
  const outR = r.filterQuery(input, (k, v) => { callsR.push(k); return pred(k, v); });
  const same = outD === outR && JSON.stringify(callsD) === JSON.stringify(callsR);
  console.log(`${same ? "same" : "DIFF"} ${JSON.stringify(input)} ${pred} delivered=${JSON.stringify(outD)} calls=${JSON.stringify(callsD)} reference=${JSON.stringify(outR)} calls=${JSON.stringify(callsR)}`);
}
