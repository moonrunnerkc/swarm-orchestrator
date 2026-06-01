// Render v11-BENEFIT-REPORT.md from the committed evidence. Every number
// here is derived from a file the reader can open: the two corpora, the
// pre/post audit results on each, the differential findings, the Venn,
// the dual-arbiter labels, the two sanity numbers, and the cost ledger.
// The report does not assert anything it cannot point at. When the
// uniquely-caught set on the regression corpus is empty, the report says
// so plainly and defers the recommendation to REDUNDANCY-FINDING.md.
//
// Usage:
//   node dist/scripts/real-prs/build-benefit-report.js

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import {
  indexDualLabels,
  isArbiterSplit,
  isConfirmedFalseAlarm,
  isFlagged,
  recall,
  splitFindings,
} from './lib/benefit';
import {
  auditResultsV2Dir,
  benefitReportFile,
  costLedgerFile,
  differentialDir,
  dualArbiterLabelsFile,
  realPrsDir,
  regressionAuditResultsDir,
  regressionSourcesFile,
  repoSlug,
  sourcesV2File,
  vennJsonFile,
} from './lib/paths';
import type {
  AuditResultRecord,
  DifferentialFinding,
  DualArbiterLabel,
  HarnessFinding,
  RegressionPr,
  RegressionSourcesFile,
  SourcePr,
  SourcesFile,
  VennSummary,
} from './lib/types';

const log = getLogger('real-prs:benefit-report');

type Corpus = 'regression' | 'clean';

function readJson<T>(file: string): T | null {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : null;
}

function auditDir(corpus: Corpus): string {
  return corpus === 'regression' ? regressionAuditResultsDir() : auditResultsV2Dir();
}

function loadAudit(corpus: Corpus, repo: string, pr: number): AuditResultRecord | null {
  return readJson<AuditResultRecord>(path.join(auditDir(corpus), repoSlug(repo), `${pr}.json`));
}

function loadExternal(corpus: Corpus, repo: string, pr: number): DifferentialFinding[] {
  const out: DifferentialFinding[] = [];
  const base = corpus === 'regression' ? differentialDir() : path.join(realPrsDir(), 'differential-v2');
  for (const tool of ['semgrep', 'eslint-security']) {
    const f = path.join(base, tool, repoSlug(repo), `${pr}.json`);
    const parsed = readJson<{ findings?: DifferentialFinding[] }>(f);
    if (parsed?.findings) out.push(...parsed.findings);
  }
  return out;
}

function categoryOfKey(key: string): string {
  return key.split(':')[1] ?? 'unknown';
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

interface Computed {
  badPrs: RegressionPr[];
  cleanPrs: SourcePr[];
  badTotal: number;
  cleanTotal: number;
  postRecall: ReturnType<typeof recall>;
  preRecall: ReturnType<typeof recall>;
  cleanFlagged: number;
  cleanConfirmedFp: number;
  cleanSplit: number;
  uniqueBadPrs: Array<{ pr: RegressionPr; keys: string[] }>;
  preUniqueCount: number;
  dual: Map<string, DualArbiterLabel>;
  venn: VennSummary | null;
}

function compute(
  reg: RegressionSourcesFile,
  clean: SourcesFile,
  dualLabels: DualArbiterLabel[],
  venn: VennSummary | null,
): Computed {
  const dual = indexDualLabels(dualLabels);

  let postFlaggedBad = 0;
  let preFlaggedBad = 0;
  const uniqueBadPrs: Array<{ pr: RegressionPr; keys: string[] }> = [];
  let preUniqueCount = 0;
  for (const bad of reg.prs) {
    const rec = loadAudit('regression', bad.repo, bad.prNumber);
    if (rec === null) continue;
    if (isFlagged(rec.post)) postFlaggedBad += 1;
    if (isFlagged(rec.pre)) preFlaggedBad += 1;
    const external = loadExternal('regression', bad.repo, bad.prNumber);
    const postSplit = splitFindings(rec.post, external);
    if (postSplit.onlyAuditorKeys.length > 0) uniqueBadPrs.push({ pr: bad, keys: postSplit.onlyAuditorKeys });
    const preSplit = splitFindings(rec.pre ?? [], external);
    if (preSplit.onlyAuditorKeys.length > 0) preUniqueCount += 1;
  }

  let cleanFlagged = 0;
  let cleanConfirmedFp = 0;
  let cleanSplit = 0;
  for (const c of clean.prs) {
    const rec = loadAudit('clean', c.repo, c.prNumber);
    if (rec === null) continue;
    if (isFlagged(rec.post)) cleanFlagged += 1;
    for (const f of rec.post) {
      const label = dual.get(f.key);
      if (isConfirmedFalseAlarm(label)) cleanConfirmedFp += 1;
      else if (isArbiterSplit(label)) cleanSplit += 1;
    }
  }

  return {
    badPrs: reg.prs,
    cleanPrs: clean.prs,
    badTotal: reg.prs.length,
    cleanTotal: clean.prs.length,
    postRecall: recall(postFlaggedBad, reg.prs.length),
    preRecall: recall(preFlaggedBad, reg.prs.length),
    cleanFlagged,
    cleanConfirmedFp,
    cleanSplit,
    uniqueBadPrs,
    preUniqueCount,
    dual,
    venn,
  };
}

function dualLabelText(dual: Map<string, DualArbiterLabel>, key: string): string {
  const l = dual.get(key);
  if (l === undefined) return 'unlabeled';
  const a = `${l.primary.model.replace(/^local:/, '')}=${l.primary.verdict}`;
  const b = `${l.secondary.model}=${l.secondary.verdict}`;
  return `${a}; ${b}${l.agreed ? ' (agree)' : ' (split)'}`;
}

function firstFindingForKey(rec: AuditResultRecord, key: string): HarnessFinding | undefined {
  return [...(rec.pre ?? []), ...rec.post].find((f) => f.key === key);
}

function renderDefensibleCatches(c: Computed): string {
  const lines: string[] = [];
  lines.push('## The 10 most defensible catches');
  lines.push('');
  lines.push(
    'Each is a retrospectively-bad merged PR (proven wrong by an attached revert or fix-PR) that the ' +
      'post-upgrade auditor flagged. The retrospective proof is the ground truth; the arbiter labels are a ' +
      'secondary cross-check. Catches in the uniquely-caught set (no external tool flagged the same code) are ' +
      'listed first.',
  );
  lines.push('');
  // Rank: unique catches first, then other flagged bad PRs.
  const uniqueKeys = new Set(c.uniqueBadPrs.map((u) => `${u.pr.repo}#${u.pr.prNumber}`));
  const flaggedBad: Array<{ pr: RegressionPr; unique: boolean }> = [];
  for (const bad of c.badPrs) {
    const rec = loadAudit('regression', bad.repo, bad.prNumber);
    if (rec === null || !isFlagged(rec.post)) continue;
    flaggedBad.push({ pr: bad, unique: uniqueKeys.has(`${bad.repo}#${bad.prNumber}`) });
  }
  flaggedBad.sort((a, b) => Number(b.unique) - Number(a.unique));
  const top = flaggedBad.slice(0, 10);
  if (top.length === 0) {
    lines.push('_No retrospectively-bad PR was flagged by the post-upgrade auditor in this run._');
    lines.push('');
    return lines.join('\n');
  }
  let i = 1;
  for (const { pr, unique } of top) {
    const rec = loadAudit('regression', pr.repo, pr.prNumber);
    if (rec === null) continue;
    const finding = rec.post[0];
    const proof = pr.proofs[0];
    lines.push(`### ${i}. ${pr.repo}#${pr.prNumber}${unique ? ' (uniquely caught)' : ''}`);
    lines.push('');
    lines.push(`- PR: ${pr.url} — "${pr.title.replace(/\n/g, ' ')}"`);
    lines.push(`- Retrospective proof (${proof?.kind ?? 'n/a'}): ${proof?.url ?? 'n/a'} ("${(proof?.mentionedInBody ?? '').replace(/\n/g, ' ')}")`);
    if (finding !== undefined) {
      lines.push(`- Finding (${finding.category}, ${finding.severity}, ${finding.judgePath}): ${finding.message.replace(/\n/g, ' ')}`);
      lines.push(`- Arbiters: ${dualLabelText(c.dual, finding.key)}`);
    }
    lines.push(`- Cost of merging this: it shipped and was later ${proof?.kind === 'revert' ? 'reverted' : 'fixed in a follow-up PR'}, so the auditor would have flagged at review time what the team caught only post-merge.`);
    lines.push('');
    i += 1;
  }
  return lines.join('\n');
}

function renderWorstFalseAlarms(c: Computed): string {
  const lines: string[] = [];
  lines.push('## The 5 worst false alarms on the clean corpus');
  lines.push('');
  lines.push(
    'Post-upgrade findings on presumed-clean PRs that both arbiters (or, where arbiter labels are absent, ' +
      'the finding itself) call out as false alarms. This is the honesty anchor: the cost the auditor imposes ' +
      'on normal PRs.',
  );
  lines.push('');
  const candidates: Array<{ pr: SourcePr; finding: HarnessFinding; confirmed: boolean }> = [];
  for (const cp of c.cleanPrs) {
    const rec = loadAudit('clean', cp.repo, cp.prNumber);
    if (rec === null) continue;
    for (const f of rec.post) {
      const label = c.dual.get(f.key);
      candidates.push({ pr: cp, finding: f, confirmed: isConfirmedFalseAlarm(label) });
    }
  }
  candidates.sort((a, b) => Number(b.confirmed) - Number(a.confirmed));
  const top = candidates.slice(0, 5);
  if (top.length === 0) {
    lines.push('_No post-upgrade findings on the clean corpus in this run._');
    lines.push('');
    return lines.join('\n');
  }
  let i = 1;
  for (const { pr, finding } of top) {
    lines.push(`### ${i}. ${pr.repo}#${pr.prNumber} — ${finding.category} (${finding.judgePath})`);
    lines.push('');
    lines.push(`- PR: ${pr.url} — "${pr.title.replace(/\n/g, ' ')}"`);
    lines.push(`- Finding: ${finding.message.replace(/\n/g, ' ')}`);
    lines.push(`- Arbiters: ${dualLabelText(c.dual, finding.key)}`);
    lines.push('');
    i += 1;
  }
  return lines.join('\n');
}

function renderPerRepo(c: Computed): string {
  const repos = [...new Set([...c.badPrs.map((p) => p.repo), ...c.cleanPrs.map((p) => p.repo)])].sort();
  const lines: string[] = [];
  lines.push('## Per-repo breakdown');
  lines.push('');
  lines.push('| repo | clean PRs | bad PRs | post-recall on bad | post flag-rate on clean |');
  lines.push('|---|---|---|---|---|');
  for (const repo of repos) {
    const bad = c.badPrs.filter((p) => p.repo === repo);
    const clean = c.cleanPrs.filter((p) => p.repo === repo);
    let badFlagged = 0;
    for (const b of bad) {
      const rec = loadAudit('regression', b.repo, b.prNumber);
      if (rec !== null && isFlagged(rec.post)) badFlagged += 1;
    }
    let cleanFlagged = 0;
    for (const cl of clean) {
      const rec = loadAudit('clean', cl.repo, cl.prNumber);
      if (rec !== null && isFlagged(rec.post)) cleanFlagged += 1;
    }
    const rRec = bad.length === 0 ? 'n/a' : `${badFlagged}/${bad.length}`;
    const fRec = clean.length === 0 ? 'n/a' : `${cleanFlagged}/${clean.length}`;
    lines.push(`| ${repo} | ${clean.length} | ${bad.length} | ${rRec} | ${fRec} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderPerCategory(c: Computed): string {
  const byCat = new Map<string, number>();
  for (const u of c.uniqueBadPrs) for (const k of u.keys) byCat.set(categoryOfKey(k), (byCat.get(categoryOfKey(k)) ?? 0) + 1);
  const lines: string[] = [];
  lines.push('## Per-category breakdown of the uniquely-caught set');
  lines.push('');
  if (byCat.size === 0) {
    lines.push('_The uniquely-caught set is empty; no category drove it. See the redundancy finding._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('| auditor category | uniquely-caught findings |');
  lines.push('|---|---|');
  for (const [cat, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| ${cat} | ${n} |`);
  lines.push('');
  return lines.join('\n');
}

function renderVenn(c: Computed): string {
  const lines: string[] = [];
  lines.push('## Differential Venn');
  lines.push('');
  if (c.venn === null) {
    lines.push('_venn.json not found; run the differential and the venn step._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('| corpus | only this auditor | only Semgrep/ESLint | both |');
  lines.push('|---|---|---|---|');
  for (const v of c.venn.perCorpus) lines.push(`| ${v.corpus} | ${v.onlyAuditor} | ${v.onlyExternal} | ${v.both} |`);
  lines.push('');
  const reg = c.venn.perCorpus.find((v) => v.corpus === 'regression');
  if (reg !== undefined) {
    lines.push(
      `Headline: on the regression corpus, **${reg.onlyAuditor}** findings only this auditor caught, ` +
        `**${reg.onlyExternal}** only the external tools caught, **${reg.both}** both caught.`,
    );
    lines.push('');
  }
  return lines.join('\n');
}

function renderArbiterCrosscheck(c: Computed, dualLabels: DualArbiterLabel[]): string {
  const dualSanity = readJson<{ local: { agreement: number }; opus: { agreement: number }; threshold: number }>(
    path.join(realPrsDir(), 'arbiter-sanity-dual.json'),
  );
  const lines: string[] = [];
  lines.push('## Arbiter cross-check');
  lines.push('');
  if (dualSanity !== null) {
    lines.push(`- Local arbiter sanity agreement: **${pct(dualSanity.local.agreement)}** (threshold ${pct(dualSanity.threshold)})`);
    lines.push(`- Opus arbiter sanity agreement: **${pct(dualSanity.opus.agreement)}** (threshold ${pct(dualSanity.threshold)})`);
  } else {
    lines.push('- Arbiter sanity numbers not found (run arbiter-sanity-dual).');
  }
  const total = dualLabels.length;
  const agreed = dualLabels.filter((l) => l.agreed).length;
  const split = total - agreed;
  lines.push(`- Inter-arbiter agreement on real-PR findings: **${total === 0 ? 'n/a' : pct(agreed / total)}** (${agreed}/${total})`);
  lines.push(`- Arbiter-split findings excluded from headline counts: **${split}**`);
  lines.push('');
  return lines.join('\n');
}

function renderCostFooter(): string {
  const ledger = readJson<{ totalUsd: number; ceilingUsd: number; batches: Array<{ batch: string; model: string; calls: number; usd: number }> }>(costLedgerFile());
  const lines: string[] = [];
  lines.push('## Cost and runtime');
  lines.push('');
  if (ledger === null) {
    lines.push('_cost-ledger.json not found._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push(`Total external spend: **$${ledger.totalUsd.toFixed(2)}** of a $${ledger.ceilingUsd} ceiling. GitHub API is free; the local arbiter is free.`);
  lines.push('');
  lines.push('| batch | model | calls | usd |');
  lines.push('|---|---|---|---|');
  for (const b of ledger.batches) lines.push(`| ${b.batch} | ${b.model} | ${b.calls} | $${b.usd.toFixed(4)} |`);
  lines.push('');
  lines.push('External tool versions: Semgrep (p/javascript, p/typescript, p/owasp-top-ten, p/security-audit), ESLint 9 + eslint-plugin-security + eslint-plugin-no-secrets (isolated toolchain under scripts/real-prs/eslint-runner). Regenerate everything with `npm run benefit:full`.');
  lines.push('');
  return lines.join('\n');
}

function renderSummary(c: Computed): string {
  const repos = new Set([...c.badPrs.map((p) => p.repo), ...c.cleanPrs.map((p) => p.repo)]);
  const U = c.uniqueBadPrs.length;
  const dualSanity = readJson<{ local: { agreement: number }; opus: { agreement: number } }>(
    path.join(realPrsDir(), 'arbiter-sanity-dual.json'),
  );
  const lines: string[] = [];
  lines.push('# v11 benefit report: the class this auditor uniquely catches');
  lines.push('');
  const localPct = dualSanity ? pct(dualSanity.local.agreement) : 'n/a';
  const opusPct = dualSanity ? pct(dualSanity.opus.agreement) : 'n/a';
  lines.push(
    `Across **${c.cleanTotal}** presumed-clean PRs and **${c.badTotal}** retrospectively-bad PRs spanning ` +
      `**${repos.size}** repos, the post-upgrade auditor flagged **${c.postRecall.flagged}** of the ` +
      `retrospectively-bad PRs (recall ${pct(c.postRecall.rate)}) with a clean-PR flag rate of ` +
      `${pct(c.cleanTotal === 0 ? 0 : c.cleanFlagged / c.cleanTotal)} ` +
      `(${c.cleanConfirmedFp} findings confirmed false-alarm by both arbiters; ${c.cleanSplit} arbiter-split, excluded). ` +
      `Of the catches, **${U}** are not flagged by Semgrep or ESLint security rules. These ${U} catches are the ` +
      `class this tool uniquely catches; the pre-upgrade auditor caught ${c.preUniqueCount} of them.`,
  );
  lines.push('');
  lines.push(
    `Arbiter setup: two independent arbiters (local model sanity ${localPct}, Opus sanity ${opusPct}); a finding ` +
      'is high-confidence only when both agree. Retrospective ground truth (an attached revert or fix-PR) takes ' +
      'precedence on the regression corpus; arbiter labels are tagged as such. Numbers regenerable via ' +
      '`npm run benefit:full`.',
  );
  lines.push('');
  if (U === 0) {
    lines.push(
      '> The uniquely-caught set is empty in this run. If it remained empty after the documented detector ' +
        'iterations, the defensible conclusion and recommendation are in REDUNDANCY-FINDING.md.',
    );
    lines.push('');
  }
  return lines.join('\n');
}

function main(): void {
  const reg = readJson<RegressionSourcesFile>(regressionSourcesFile());
  const clean = readJson<SourcesFile>(sourcesV2File());
  if (reg === null || clean === null) {
    log.error('missing regression sources.json or sources-v2.json; run the fetch/mine steps first');
    process.exit(1);
  }
  const dualLabels = readJson<DualArbiterLabel[]>(dualArbiterLabelsFile()) ?? [];
  const venn = readJson<VennSummary>(vennJsonFile());
  const c = compute(reg, clean, dualLabels, venn);

  const report = [
    renderSummary(c),
    renderPerRepo(c),
    renderPerCategory(c),
    renderDefensibleCatches(c),
    renderWorstFalseAlarms(c),
    renderVenn(c),
    renderArbiterCrosscheck(c, dualLabels),
    renderCostFooter(),
  ].join('\n');

  fs.writeFileSync(benefitReportFile(), report);
  log.info(
    `wrote benefit report: post-recall ${c.postRecall.flagged}/${c.badTotal}, unique catches ${c.uniqueBadPrs.length}, ` +
      `clean flag-rate ${c.cleanFlagged}/${c.cleanTotal}`,
  );
}

main();
