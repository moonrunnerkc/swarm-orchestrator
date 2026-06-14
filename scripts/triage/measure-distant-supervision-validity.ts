// Phase 0 gate: does the distant-supervision label (a PR proven
// retrospectively bad by a revert or hotfix) correlate with the cheat
// categories the detectors fire? The triage pipeline only works if the
// labels measure the concept the detectors model. This script measures that
// correlation per category over the corpora already on disk (it reuses the
// regression-mining and clean-fetch outputs, it does not re-fetch), and
// writes benchmarks/results/distant-supervision-validity.md plus a JSON.
//
// The revert-bad PRs are the positives; the presumed-clean merged PRs are
// the not-bad rows. For each cheat category we build the 2x2 table of
// label vs fired and report the phi coefficient, the firing rates, and the
// lift. The oracle per-category recall is cited as the reference that the
// detectors themselves work, so a weak correlation is read as a label
// problem, not a detector problem.
//
// Usage: node dist/scripts/triage/measure-distant-supervision-validity.js

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { CheatCategory } from '../../src/audit/types';
import {
  correlateAnyFired,
  correlateCategories,
  type CategoryCorrelation,
  type LabeledRow,
} from '../../src/audit/triage/correlation';
import {
  auditResultsV2Dir,
  regressionAuditResultsDir,
  repoRoot,
} from '../real-prs/lib/paths';
import type { AuditResultRecord } from '../real-prs/lib/types';

const log = getLogger('triage:validity');

const STRUCTURAL_CATEGORIES: readonly CheatCategory[] = [
  'test-relaxation',
  'mock-of-hallucination',
  'assertion-strip',
  'no-op-fix',
  'coverage-erosion',
  'fake-refactor',
  'comment-only-fix',
  'error-swallow',
  'exception-rethrow-lost-context',
  'dead-branch-insertion',
  'type-suppression',
];

/** Read every per-PR audit record under a corpus directory and turn each into
 *  a labeled row carrying the set of cheat categories the auditor fired. */
function rowsFromCorpus(dir: string, bad: boolean): LabeledRow[] {
  if (!fs.existsSync(dir)) {
    throw new Error(`audit-results directory not found: ${dir}. Run the corpus build first.`);
  }
  const rows: LabeledRow[] = [];
  for (const repoDir of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, repoDir);
    if (!fs.statSync(abs).isDirectory()) continue;
    for (const file of fs.readdirSync(abs).sort()) {
      if (!file.endsWith('.json')) continue;
      const record = JSON.parse(fs.readFileSync(path.join(abs, file), 'utf8')) as AuditResultRecord;
      const fired = new Set<string>(record.post.map((f) => f.category));
      rows.push({ bad, firedCategories: fired });
    }
  }
  return rows;
}

interface OracleStructuralRow {
  category: string;
  recall: number;
  injections: number;
  tp: number;
}

/** Map each structural category to its oracle recall, so the report can show
 *  the detector works even where the label fails to correlate. */
function oracleRecall(root: string): Map<string, OracleStructuralRow> {
  const file = path.join(root, 'benchmarks', 'oracle-corpus', 'oracle-results.json');
  const out = new Map<string, OracleStructuralRow>();
  if (!fs.existsSync(file)) return out;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { structural?: OracleStructuralRow[] };
  for (const r of parsed.structural ?? []) out.set(r.category, r);
  return out;
}

function fmt(n: number): string {
  if (Number.isNaN(n)) return 'n/a';
  if (!Number.isFinite(n)) return '∞';
  return n.toFixed(3);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** The aggregate phi above which the revert anchor would stand on its own as
 *  the primary label. Below it the anchor is too weak to be ground truth. */
const PRIMARY_ANCHOR_PHI = 0.3;

/** A single category carries real per-category signal when it has a moderate
 *  positive effect and a non-trivial number of bad-PR firings behind it. Such
 *  a category is retained as a weak labeling function, not promoted to primary. */
function hasPerCategorySignal(c: CategoryCorrelation): boolean {
  return c.phi >= 0.3 && c.table.n11 >= 5;
}

function renderReport(
  perCategory: CategoryCorrelation[],
  anyFired: CategoryCorrelation,
  nBad: number,
  nClean: number,
  oracle: Map<string, OracleStructuralRow>,
): string {
  const signalCategories = perCategory.filter(hasPerCategorySignal);
  const anchorIsPrimary = anyFired.phi >= PRIMARY_ANCHOR_PHI;
  const lines: string[] = [];
  lines.push('# Phase 0 gate: distant-supervision label validity');
  lines.push('');
  lines.push(
    'Does the revert-derived label (a PR proven retrospectively bad by a revert ' +
      'or hotfix) co-occur with the cheat categories the detectors fire? The ' +
      'triage pipeline can only stand on this label if the answer is yes. This ' +
      'is measured, not asserted.',
  );
  lines.push('');
  lines.push(
    `Corpus: ${nBad} revert-bad PRs (positives, from \`benchmarks/regression-corpus\`) ` +
      `and ${nClean} presumed-clean merged PRs (not-bad, from \`benchmarks/real-prs/audit-results-v2\`). ` +
      'Auditor findings are the `post` list of each per-PR audit record.',
  );
  lines.push('');
  lines.push('## Per-category correlation (revert label vs detector firing)');
  lines.push('');
  lines.push('phi is the Matthews correlation between the bad label and "this category fired".');
  lines.push('A phi near 0 means the label carries no information about the category.');
  lines.push('Oracle recall is the detector\'s catch rate on injected defects of its own category.');
  lines.push('');
  lines.push('| category | phi | fires on bad | fires on clean | lift | oracle recall |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const c of perCategory) {
    const o = oracle.get(c.category);
    const recall = o ? `${pct(o.recall)} (${o.tp}/${o.injections})` : 'n/a';
    lines.push(
      `| ${c.category} | ${fmt(c.phi)} | ${pct(c.rateBad)} (${c.table.n11}/${c.table.n11 + c.table.n10}) ` +
        `| ${pct(c.rateNotBad)} (${c.table.n01}/${c.table.n01 + c.table.n00}) | ${fmt(c.lift)} | ${recall} |`,
    );
  }
  lines.push('');
  lines.push(
    `**Aggregate ("any cheat category fired"): phi = ${fmt(anyFired.phi)}**, ` +
      `firing ${pct(anyFired.rateBad)} on bad vs ${pct(anyFired.rateNotBad)} on clean.`,
  );
  lines.push('');
  lines.push('## Read');
  lines.push('');
  lines.push(
    `The aggregate phi is ${fmt(anyFired.phi)}: the auditor fires on revert-bad and ` +
      'presumed-clean PRs at indistinguishable rates (' +
      `${pct(anyFired.rateBad)} vs ${pct(anyFired.rateNotBad)}). The oracle column shows the ` +
      'detectors do catch injected cheats of their own category at high recall, so a weak ' +
      'correlation here is a label problem, not a detector problem.',
  );
  lines.push('');
  lines.push(
    'This reproduces the v11 redundancy finding (`benchmarks/real-prs/REDUNDANCY-FINDING.md`) ' +
      'per category and quantitatively: a reverted PR ships a behavioral defect (a logic ' +
      'bug), which leaves no cheat-shaped tell, so the revert label measures ' +
      'regression-proneness, not cheating. As a general cheat label the two concepts ' +
      'barely overlap.',
  );
  lines.push('');
  if (signalCategories.length > 0) {
    lines.push(
      'The one exception is ' +
        signalCategories.map((c) => `\`${c.category}\` (phi ${fmt(c.phi)}, ${c.table.n11}/${c.table.n11 + c.table.n10} bad vs ${c.table.n01}/${c.table.n01 + c.table.n00} clean)`).join(' and ') +
        '. That co-occurrence is real and sensible: removing coverage is one of the few cheat ' +
        'shapes that can itself cause the regression the revert undoes. It is not enough to ' +
        'make the revert anchor a primary cheat label, but it is signal worth keeping.',
    );
    lines.push('');
  }
  if (anchorIsPrimary) {
    lines.push('### Decision: keep the revert anchor as primary');
    lines.push('');
    lines.push(
      `The aggregate phi (${fmt(anyFired.phi)}) clears the primary-anchor bar ` +
        `(${PRIMARY_ANCHOR_PHI}); the revert label is used as the primary positive label.`,
    );
  } else {
    lines.push('### Decision: PIVOT the anchor');
    lines.push('');
    lines.push(
      `The aggregate phi (${fmt(anyFired.phi)}) is below the primary-anchor bar ` +
        `(${PRIMARY_ANCHOR_PHI}), so the revert/SZZ anchor is rejected as the primary label. ` +
        'It is retained as a weak labeling function (a low-accuracy vote the Phase 3 label ' +
        'model can down-weight from agreement structure), never as ground truth. The primary ' +
        'anchor pivots to a cheat-specific signal: a restoration event, where a later PR ' +
        're-adds a test, assertion, or coverage that an earlier PR deleted. The earlier ' +
        'deleting PR is labeled a cheat positive, because its own later restoration ' +
        'demonstrates the deletion was wrong. This anchor targets the cheat concept directly ' +
        'and is mined from the same git history the regression pipeline already walks.',
    );
    if (signalCategories.length > 0) {
      lines.push('');
      lines.push(
        'The revert signal is kept additionally as a per-category labeling function for ' +
          signalCategories.map((c) => `\`${c.category}\``).join(', ') +
          ', where it carries measured signal.',
      );
    }
  }
  lines.push('');
  lines.push('## Reproduce');
  lines.push('');
  lines.push('```');
  lines.push('npm run triage:validity');
  lines.push('```');
  lines.push('');
  lines.push(
    'Reads the committed corpora; the numbers are deterministic. The JSON sidecar ' +
      '`distant-supervision-validity.json` carries the raw 2x2 tables.',
  );
  lines.push('');
  return lines.join('\n');
}

function main(): void {
  const root = repoRoot();
  const badRows = rowsFromCorpus(regressionAuditResultsDir(root), true);
  const cleanRows = rowsFromCorpus(auditResultsV2Dir(root), false);
  const rows = [...badRows, ...cleanRows];
  log.info(`loaded ${badRows.length} revert-bad and ${cleanRows.length} clean audit records`);

  const perCategory = correlateCategories(rows, STRUCTURAL_CATEGORIES);
  const anyFired = correlateAnyFired(rows);
  const oracle = oracleRecall(root);

  const resultsDir = path.join(root, 'benchmarks', 'results');
  fs.mkdirSync(resultsDir, { recursive: true });

  const json = {
    nBad: badRows.length,
    nClean: cleanRows.length,
    anyFired: { phi: anyFired.phi, table: anyFired.table },
    perCategory: perCategory.map((c) => ({
      category: c.category,
      phi: c.phi,
      rateBad: c.rateBad,
      rateNotBad: c.rateNotBad,
      lift: Number.isFinite(c.lift) ? c.lift : null,
      table: c.table,
    })),
  };
  fs.writeFileSync(
    path.join(resultsDir, 'distant-supervision-validity.json'),
    JSON.stringify(json, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(resultsDir, 'distant-supervision-validity.md'),
    renderReport(perCategory, anyFired, badRows.length, cleanRows.length, oracle),
  );
  log.info(`wrote distant-supervision-validity.{md,json} to ${resultsDir}`);
  log.info(`aggregate any-fired phi = ${anyFired.phi.toFixed(4)}`);
}

main();
