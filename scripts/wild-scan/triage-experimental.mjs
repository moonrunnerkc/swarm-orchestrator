#!/usr/bin/env node
// For findings in the experimental set that don't exist in the default set,
// print a triage-friendly view: category, severity, repo, PR, file, message.

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

const NEW_CATEGORIES = new Set([
  'coverage-erosion',
  'test-relaxation',
  'assertion-strip',
]);

const findings = [];
for (const f of walk('outputs/wild-scan/raw-experimental')) {
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  const pr = r.result?.pr ?? r.pr ?? {};
  for (const finding of r.result?.findings ?? []) {
    if (!NEW_CATEGORIES.has(finding.category)) continue;
    findings.push({
      repo: pr.repository,
      pr: pr.number,
      title: pr.title,
      category: finding.category,
      severity: finding.severity,
      file: finding.location?.file,
      line: finding.location?.line,
      message: finding.message,
      evidence: finding.evidence,
    });
  }
}

// Group by category, then PR.
const byCat = {};
for (const f of findings) {
  (byCat[f.category] ??= []).push(f);
}

for (const [cat, list] of Object.entries(byCat)) {
  console.log(`\n=== ${cat} (${list.length}) ===`);
  const seen = new Set();
  for (const f of list) {
    const key = `${f.repo}#${f.pr}::${f.file}`;
    if (seen.has(key)) continue; // one example per (PR, file)
    seen.add(key);
    console.log(
      `\n  [${f.severity}] ${f.repo}#${f.pr} :: ${f.file}:${f.line}`,
    );
    console.log(`    title: ${(f.title ?? '').slice(0, 80)}`);
    console.log(`    msg  : ${(f.message ?? '').slice(0, 180)}`);
  }
}
