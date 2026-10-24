// Re-runs the hidden check's predicate-call case and the two file:/// cases on a checkout, printing
// the untruncated assertion message, plus the call trace and withQuery's own answers.
// Usage: node full-predicate-case.mjs <checkout> <jiti-dir>
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const [checkout, jitiDir] = process.argv.slice(2);
const { createJiti } = await import(pathToFileURL(`${jitiDir}/lib/jiti.mjs`).href);
const u = await createJiti(pathToFileURL(`${checkout}/`).href).import(`${checkout}/src/index.ts`);
const calls = [];
const result = u.filterQuery("/p?b=2&a=1&a=3&caf%C3%A9=x&e", (...args) => { calls.push([args[0], args[1]]); return true; });
console.log("predicate calls:", JSON.stringify(calls));
console.log("result:", JSON.stringify(result));
try { assert.deepEqual(calls, [["b", "2"], ["a", ["1", "3"]], ["café", "x"], ["e", ""]]); console.log("predicate case passes"); }
catch (e) { console.log("FULL MESSAGE:\n" + e.message); }
for (const [input, pred] of [["file:///C:/x?bar=1&k=v", () => true], ["file:///C:/x?bar=1&k=v", (k) => k !== "bar"]]) {
  console.log(JSON.stringify(input), String(pred), "->", JSON.stringify(u.filterQuery(input, pred)), "| withQuery(input,{}) =", JSON.stringify(u.withQuery(input, {})));
}
// Extra divergences from withQuery not covered by the hidden check (observed, reported separately).
for (const [input, pred] of [["/foo?bar=1#frag", () => false], ["?bar=1", () => false], ["/foo?bar=1&baz=2#h", () => false]]) {
  const p = u.parseURL(input); p.search = ""; 
  console.log("extra", JSON.stringify(input), String(pred), "->", JSON.stringify(u.filterQuery(input, pred)), "| withQuery-style rebuild with no params =", JSON.stringify(u.stringifyParsedURL(p)));
}
