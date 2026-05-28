#!/usr/bin/env node
// Walk outputs/wild-scan/raw/**/audit-*.json and produce:
//   1. outputs/wild-scan/summary.json — machine-readable rollup
//   2. outputs/wild-scan/summary.md   — human-readable rollup
//   3. outputs/wild-scan/findings-ranked.json — per-finding rows, ranked
//
// "Ranked" finding score: warn > info, blocking detectors weighted higher,
// pure-data PRs (no source touched) deprioritized. Used to pick the top
// candidates for manual triage.

import fs from 'node:fs';
import path from 'node:path';

const RAW = 'outputs/wild-scan/raw';
const OUT_DIR = 'outputs/wild-scan';

// Detectors considered "blocking-grade" in the default set.
const BLOCKING = new Set([
  'test-relaxation',
  'mock-of-hallucination',
  'assertion-strip',
  'no-op-fix',
  'error-swallow',
]);

const SEVERITY_WEIGHT = { error: 4, warn: 2, info: 0 };

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(p);
  }
  return out;
}

function loadRecords() {
  return walk(RAW).map((file) => {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { file, raw };
  });
}

function classify(record) {
  const r = record.raw;
  const findings = r.result?.findings ?? [];
  const pr = r.result?.pr ?? r.pr ?? {};
  const repoLabel = r.repo ?? 'unknown';
  const repoFull = pr.repository ?? repoLabel;
  const agent = r.result?.agent ?? r.agent ?? null;

  // Severity buckets (counts only non-info if available).
  const byCategory = {};
  let warnOrError = 0;
  let blockingFindings = 0;
  for (const f of findings) {
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    if (f.severity === 'warn' || f.severity === 'error') warnOrError++;
    if (BLOCKING.has(f.category) && f.severity !== 'info') blockingFindings++;
  }

  return {
    repoLabel,
    repoFull,
    prNumber: pr.number,
    prTitle: pr.title ?? '',
    prAuthor: pr.author ?? 'unknown',
    headSha: pr.headSha ?? null,
    agentVendor: agent?.vendor ?? null,
    agentConfidence: agent?.confidence ?? null,
    pass: r.result?.pass ?? null,
    findingCount: findings.length,
    warnOrError,
    blockingFindings,
    byCategory,
    findings,
    file: record.file,
  };
}

function score(row) {
  let s = 0;
  for (const f of row.findings) {
    const w = SEVERITY_WEIGHT[f.severity] ?? 0;
    const bonus = BLOCKING.has(f.category) ? 3 : 0;
    s += w + bonus;
  }
  return s;
}

function tally(rows, key) {
  const m = {};
  for (const r of rows) {
    const k = r[key] ?? 'unknown';
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}

function mdTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)),
  );
  const fmt = (cells) =>
    '| ' + cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ') + ' |';
  const sep = '| ' + widths.map((w) => '-'.repeat(w)).join(' | ') + ' |';
  return [fmt(headers), sep, ...rows.map(fmt)].join('\n');
}

function main() {
  const records = loadRecords();
  const rows = records.map(classify);
  rows.sort((a, b) => score(b) - score(a));

  // Per-repo summary.
  const perRepo = {};
  for (const r of rows) {
    const k = r.repoFull;
    if (!perRepo[k]) {
      perRepo[k] = {
        repo: k,
        prCount: 0,
        passCount: 0,
        warnOrErrorTotal: 0,
        blockingTotal: 0,
        byCategory: {},
      };
    }
    const e = perRepo[k];
    e.prCount++;
    if (r.pass) e.passCount++;
    e.warnOrErrorTotal += r.warnOrError;
    e.blockingTotal += r.blockingFindings;
    for (const [cat, n] of Object.entries(r.byCategory)) {
      e.byCategory[cat] = (e.byCategory[cat] ?? 0) + n;
    }
  }

  // Per-agent summary.
  const perAgent = {};
  for (const r of rows) {
    const k = r.agentVendor ?? 'unidentified';
    if (!perAgent[k]) {
      perAgent[k] = { agent: k, prCount: 0, warnOrErrorTotal: 0, blockingTotal: 0 };
    }
    const e = perAgent[k];
    e.prCount++;
    e.warnOrErrorTotal += r.warnOrError;
    e.blockingTotal += r.blockingFindings;
  }

  // Per-detector totals across the corpus.
  const perCategory = {};
  for (const r of rows) {
    for (const [cat, n] of Object.entries(r.byCategory)) {
      perCategory[cat] = (perCategory[cat] ?? 0) + n;
    }
  }

  // Ranked findings — flatten one row per finding for triage.
  const ranked = [];
  for (const r of rows) {
    for (const f of r.findings) {
      ranked.push({
        repo: r.repoFull,
        pr: r.prNumber,
        prTitle: r.prTitle,
        author: r.prAuthor,
        agent: r.agentVendor,
        category: f.category,
        severity: f.severity,
        message: f.message,
        file: f.location?.file,
        line: f.location?.line,
        evidence: f.evidence,
        url: `https://github.com/${r.repoFull}/pull/${r.prNumber}`,
        score:
          (SEVERITY_WEIGHT[f.severity] ?? 0) + (BLOCKING.has(f.category) ? 3 : 0),
      });
    }
  }
  ranked.sort((a, b) => b.score - a.score);

  const summary = {
    generatedAt: new Date().toISOString(),
    totals: {
      prCount: rows.length,
      passCount: rows.filter((r) => r.pass).length,
      withAnyFinding: rows.filter((r) => r.findingCount > 0).length,
      withWarnOrError: rows.filter((r) => r.warnOrError > 0).length,
      withBlocking: rows.filter((r) => r.blockingFindings > 0).length,
      findingsTotal: rows.reduce((s, r) => s + r.findingCount, 0),
    },
    perRepo: Object.values(perRepo).sort((a, b) => b.blockingTotal - a.blockingTotal),
    perAgent: Object.values(perAgent).sort((a, b) => b.blockingTotal - a.blockingTotal),
    perCategory,
    rows: rows.map((r) => ({
      repo: r.repoFull,
      pr: r.prNumber,
      title: r.prTitle,
      author: r.prAuthor,
      agent: r.agentVendor,
      pass: r.pass,
      findingCount: r.findingCount,
      warnOrError: r.warnOrError,
      blocking: r.blockingFindings,
      byCategory: r.byCategory,
      score: score(r),
    })),
  };

  fs.writeFileSync(
    path.join(OUT_DIR, 'summary.json'),
    JSON.stringify(summary, null, 2),
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'findings-ranked.json'),
    JSON.stringify(ranked, null, 2),
  );

  // Markdown rollup.
  const md = [];
  md.push('# Wild PR Scan — Summary');
  md.push('');
  md.push(`Generated: ${summary.generatedAt}`);
  md.push('');
  md.push('## Totals');
  md.push('');
  md.push(`- PRs audited: **${summary.totals.prCount}**`);
  md.push(`- Passed (no blocking findings): **${summary.totals.passCount}**`);
  md.push(`- PRs with at least one finding: **${summary.totals.withAnyFinding}**`);
  md.push(`- PRs with warn-or-error findings: **${summary.totals.withWarnOrError}**`);
  md.push(`- PRs with blocking-grade findings: **${summary.totals.withBlocking}**`);
  md.push(`- Total findings: **${summary.totals.findingsTotal}**`);
  md.push('');
  md.push('## Per repository');
  md.push('');
  md.push(
    mdTable(
      ['Repo', 'PRs', 'Pass', 'Warn/Err', 'Blocking'],
      summary.perRepo.map((e) => [
        e.repo,
        e.prCount,
        e.passCount,
        e.warnOrErrorTotal,
        e.blockingTotal,
      ]),
    ),
  );
  md.push('');
  md.push('## Per detected agent');
  md.push('');
  md.push(
    mdTable(
      ['Agent', 'PRs', 'Warn/Err', 'Blocking'],
      summary.perAgent.map((e) => [
        e.agent,
        e.prCount,
        e.warnOrErrorTotal,
        e.blockingTotal,
      ]),
    ),
  );
  md.push('');
  md.push('## Per detector category (totals)');
  md.push('');
  md.push(
    mdTable(
      ['Category', 'Total findings'],
      Object.entries(perCategory)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, v]),
    ),
  );
  md.push('');
  md.push('## Top-ranked individual findings (first 25)');
  md.push('');
  md.push(
    mdTable(
      ['Score', 'Severity', 'Category', 'Repo#PR', 'File', 'Message'],
      ranked.slice(0, 25).map((f) => [
        f.score,
        f.severity,
        f.category,
        `${f.repo}#${f.pr}`,
        f.file ?? '',
        (f.message ?? '').slice(0, 80),
      ]),
    ),
  );
  md.push('');

  fs.writeFileSync(path.join(OUT_DIR, 'summary.md'), md.join('\n'));

  console.log(`wrote ${OUT_DIR}/summary.json`);
  console.log(`wrote ${OUT_DIR}/summary.md`);
  console.log(`wrote ${OUT_DIR}/findings-ranked.json`);
  console.log('');
  console.log(`PRs: ${summary.totals.prCount}`);
  console.log(`with any finding: ${summary.totals.withAnyFinding}`);
  console.log(`with warn/err: ${summary.totals.withWarnOrError}`);
  console.log(`with blocking: ${summary.totals.withBlocking}`);
}

main();
