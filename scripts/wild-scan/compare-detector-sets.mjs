#!/usr/bin/env node
// Compare detector-set output: default (raw/) vs experimental (raw-experimental/).
// Prints per-category totals side-by-side so we can tell whether the six
// retired detectors actually find anything new on this corpus.

import fs from 'node:fs';
import path from 'node:path';

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(p);
  }
  return out;
}

function tally(dir) {
  const counts = { _total: 0 };
  for (const f of walk(dir)) {
    const r = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const finding of r.result?.findings ?? []) {
      counts[finding.category] = (counts[finding.category] ?? 0) + 1;
      counts._total++;
    }
  }
  return counts;
}

const def = tally('outputs/wild-scan/raw');
const exp = tally('outputs/wild-scan/raw-experimental');

const keys = new Set([...Object.keys(def), ...Object.keys(exp)]);
keys.delete('_total');

const rows = [...keys]
  .map((k) => [k, def[k] ?? 0, exp[k] ?? 0, (exp[k] ?? 0) - (def[k] ?? 0)])
  .sort((a, b) => b[2] - a[2]);

console.log('detector totals across 48-PR corpus');
console.log('');
console.log('category                              default  experimental  delta');
for (const [k, d, e, delta] of rows) {
  console.log(
    `${k.padEnd(36)}  ${String(d).padStart(7)}  ${String(e).padStart(12)}  ${String(delta).padStart(5)}`,
  );
}
console.log(
  `${'_TOTAL'.padEnd(36)}  ${String(def._total).padStart(7)}  ${String(exp._total).padStart(12)}  ${String(exp._total - def._total).padStart(5)}`,
);
