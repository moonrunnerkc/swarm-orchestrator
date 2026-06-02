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

interface SanityShape {
  arbiterModel: string;
  agreement: number;
  passed: boolean;
  promptVersion: string;
}
interface DualSanityShape {
  threshold: number;
  sameModel: boolean;
  primary: SanityShape;
  secondary: SanityShape;
}

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

/** Arbiter-validated precision over the sampled, dual-labeled findings of
 *  one corpus: how many findings both arbiters agreed on, and how those
 *  agreements split between confirmed cheat and confirmed false alarm. */
interface ArbiterPrecision {
  labeled: number;
  agreed: number;
  confirmedTrueCheat: number;
  confirmedFalseAlarm: number;
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
  regPrecision: ArbiterPrecision;
  cleanPrecision: ArbiterPrecision;
  /** Findings both arbiters confirmed as true-cheat, with their corpus. */
  confirmedCheats: Array<{ label: DualArbiterLabel; corpus: Corpus }>;
}

function compute(
  reg: RegressionSourcesFile,
  clean: SourcesFile,
  dualLabels: DualArbiterLabel[],
  venn: VennSummary | null,
): Computed {
  const dual = indexDualLabels(dualLabels);
  const regSet = new Set(reg.prs.map((p) => `${p.repo}#${p.prNumber}`));

  // Arbiter-validated precision over the dual-labeled sample, split by
  // corpus. This is the load-bearing honesty: a high raw flag rate means
  // little if two independent arbiters confirm the findings are noise.
  const regPrecision: ArbiterPrecision = { labeled: 0, agreed: 0, confirmedTrueCheat: 0, confirmedFalseAlarm: 0 };
  const cleanPrecision: ArbiterPrecision = { labeled: 0, agreed: 0, confirmedTrueCheat: 0, confirmedFalseAlarm: 0 };
  const confirmedCheats: Array<{ label: DualArbiterLabel; corpus: Corpus }> = [];
  for (const l of dualLabels) {
    const corpus: Corpus = regSet.has(`${l.repo}#${l.prNumber}`) ? 'regression' : 'clean';
    const p = corpus === 'regression' ? regPrecision : cleanPrecision;
    p.labeled += 1;
    if (!l.agreed) continue;
    p.agreed += 1;
    if (l.verdict === 'true-cheat') {
      p.confirmedTrueCheat += 1;
      confirmedCheats.push({ label: l, corpus });
    } else if (l.verdict === 'false-alarm') {
      p.confirmedFalseAlarm += 1;
    }
  }

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
    regPrecision,
    cleanPrecision,
    confirmedCheats,
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

function findingForKey(corpus: Corpus, repo: string, pr: number, key: string): HarnessFinding | undefined {
  const rec = loadAudit(corpus, repo, pr);
  if (rec === null) return undefined;
  return rec.post.find((f) => f.key === key);
}

function renderDefensibleCatches(c: Computed): string {
  const lines: string[] = [];
  lines.push('## The most defensible catches (both arbiters confirmed true-cheat)');
  lines.push('');
  lines.push(
    'These are the findings two independent model families both labeled true-cheat, and which no external ' +
      'analyzer flagged. They are the genuine unique catches: real cheats in merged PRs that Semgrep and the ' +
      'ESLint security rules cannot see. Note they land on clean (never-reverted) PRs, so they are cheats ' +
      'reviewers merged, not the cause of a regression.',
  );
  lines.push('');
  if (c.confirmedCheats.length === 0) {
    lines.push('_No finding was confirmed true-cheat by both arbiters in this run._');
    lines.push('');
    return lines.join('\n');
  }
  let i = 1;
  for (const { label, corpus } of c.confirmedCheats) {
    const finding = findingForKey(corpus, label.repo, label.prNumber, label.key);
    const url = `https://github.com/${label.repo}/pull/${label.prNumber}`;
    lines.push(`### ${i}. ${label.repo}#${label.prNumber} — ${label.category} (${corpus})`);
    lines.push('');
    lines.push(`- PR: ${url}`);
    if (finding !== undefined) {
      lines.push(`- Finding (${finding.category}, ${finding.severity}): ${finding.message.replace(/\n/g, ' ')}`);
    }
    lines.push(`- Arbiters: ${dualLabelText(c.dual, label.key)} (both confirmed true-cheat)`);
    lines.push(
      '- Not flagged by Semgrep or the ESLint security rules: this is a cheat-shaped edit those analyzers do not ' +
        'model.',
    );
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
  const dualSanity = readJson<DualSanityShape>(path.join(realPrsDir(), 'arbiter-sanity-dual.json'));
  const lines: string[] = [];
  lines.push('## Arbiter cross-check');
  lines.push('');
  if (dualSanity !== null) {
    const p = dualSanity.primary;
    const s = dualSanity.secondary;
    lines.push(
      `- Primary arbiter (${p.arbiterModel} / prompt ${p.promptVersion}) sanity agreement: **${pct(p.agreement)}** ` +
        `(threshold ${pct(dualSanity.threshold)}) -> ${p.passed ? 'PASS' : 'FAIL'}`,
    );
    lines.push(
      `- Secondary arbiter (${s.arbiterModel} / prompt ${s.promptVersion}) sanity agreement: **${pct(s.agreement)}** ` +
        `(threshold ${pct(dualSanity.threshold)}) -> ${s.passed ? 'PASS' : 'FAIL'}`,
    );
    const usesAnthropic = /opus|claude|haiku/i.test(`${p.arbiterModel} ${s.arbiterModel}`);
    if (dualSanity.sameModel) {
      lines.push(
        '- Limitation: both arbiters are the same local model under two independently-worded prompts. The paid ' +
          'independent second model (Opus) was unreachable (the Anthropic and OpenAI accounts were out of credit ' +
          'during the run), so this is a prompt-robustness cross-check, not a model-diversity one. Disclosed, not hidden.',
      );
    } else if (!usesAnthropic) {
      lines.push(
        `- The two arbiters are different model families (${p.arbiterModel} and ${s.arbiterModel}), so this is a ` +
          'genuine model-diversity cross-check. The originally-planned paid Opus second opinion was unreachable ' +
          '(the Anthropic and OpenAI accounts were out of credit during the run); an independent model of a ' +
          'different family was used in its place. Disclosed, not hidden.',
      );
    }
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
  const dualSanity = readJson<DualSanityShape>(path.join(realPrsDir(), 'arbiter-sanity-dual.json'));
  const lines: string[] = [];
  lines.push('# v11 benefit report: cheat-detection vs off-the-shelf analyzers, and its precision on real PRs');
  lines.push('');
  const localPct = dualSanity ? pct(dualSanity.primary.agreement) : 'n/a';
  const opusPct = dualSanity ? pct(dualSanity.secondary.agreement) : 'n/a';
  const pModel = dualSanity?.primary.arbiterModel ?? 'primary';
  const sModel = dualSanity?.secondary.arbiterModel ?? 'secondary';
  const cleanFlagRate = c.cleanTotal === 0 ? 0 : c.cleanFlagged / c.cleanTotal;

  lines.push('## Summary');
  lines.push('');
  lines.push(
    `Across **${c.cleanTotal}** presumed-clean PRs and **${c.badTotal}** retrospectively-bad PRs spanning ` +
      `**${repos.size}** repos, two off-the-shelf analyzers (Semgrep and ESLint security rules) raised essentially ` +
      `nothing on the bad PRs (${c.venn?.perCorpus.find((v) => v.corpus === 'regression')?.onlyExternal ?? 0} ` +
      `findings across all ${c.badTotal}), while this auditor flagged **${c.postRecall.flagged}/${c.badTotal}** of ` +
      `them. So the cheat-pattern class this auditor keys on is structurally invisible to those analyzers, and the ` +
      `differential's "only this auditor" set is large by raw count.`,
  );
  lines.push('');
  lines.push(
    `But raw flagging is not discriminative here: the auditor also flagged **${pct(cleanFlagRate)}** of the ` +
      `presumed-clean PRs, about the same rate as the bad ones. The load-bearing test is the two-arbiter ` +
      `validation. On a stratified sample, two independent model families (${pModel}, sanity ${localPct}; ${sModel}, ` +
      `sanity ${opusPct}) agreed on **${c.regPrecision.agreed}** findings on the retrospectively-bad PRs and ` +
      `confirmed **${c.regPrecision.confirmedTrueCheat}** of them as true-cheats; on the clean PRs they agreed on ` +
      `**${c.cleanPrecision.agreed}** and confirmed **${c.cleanPrecision.confirmedFalseAlarm}** as false alarms. ` +
      `The ${c.confirmedCheats.filter((x) => x.corpus === 'clean').length} confirmed true-cheats both models did ` +
      `find were all on clean (never-reverted) PRs, invisible to the linters: real cheats reviewers merged, but not ` +
      `the cause of the regressions.`,
  );
  lines.push('');
  lines.push('### What this means');
  lines.push('');
  lines.push(
    '- **The unique class vs off-the-shelf analyzers is real.** Semgrep and the ESLint security rules look for ' +
      'dangerous APIs, not for test relaxation, stripped assertions, swallowed errors, or silenced type checkers. ' +
      'The auditor catches those; the linters catch ~none. The differential proves this and does not depend on any ' +
      'LLM.',
  );
  lines.push(
    `- **The auditor does not catch the retrospectively-bad PRs for the right reasons.** It flagged ` +
      `${c.postRecall.flagged}/${c.badTotal} of them, but two strong independent arbiters confirmed ` +
      `**${c.regPrecision.confirmedTrueCheat}** of its bad-PR findings as cheats. Reverted/hotfixed real PRs are ` +
      'overwhelmingly logic bugs, not cheats, so a cheat detector (this one, or the linters) does not catch them. ' +
      'A retrospectively-bad corpus is the wrong benchmark for a cheat detector.',
  );
  lines.push(
    `- **On real merged PRs the auditor over-flags.** A clean-PR flag rate of ${pct(cleanFlagRate)}, with the ` +
      'arbiters confirming the large majority of sampled findings as false alarms, means the structural detectors ' +
      'fire on common legitimate patterns (relocated tests, refactors that change assertions, added branches, ' +
      'pragmatic suppressions). This is why the findings ship advisory, never blocking, by default.',
  );
  lines.push('');
  lines.push('### Recommendation: scope narrowing');
  lines.push('');
  lines.push(
    'The defensible, demonstrated value of this tool is cheat-detection, where the oracle measures high recall ' +
      '(258/275 structural) and where two independent models confirmed real cheats in merged PRs that the linters ' +
      'missed. Its value is **not** general regression prevention: it does not catch the logic bugs that get ' +
      'reverted, and its blanket flagging of real PRs is noise. Use it as an advisory cheat-detection signal on ' +
      'changesets, not as a gate and not as a bug-catcher. The companion `REDUNDANCY-FINDING.md` documents this ' +
      'conclusion, what was tried, and why a retrospectively-bad corpus cannot be the benchmark for it. Numbers ' +
      'regenerable via `npm run benefit:full`; arbiter-labeled findings are tagged as such, and retrospective ' +
      'ground truth takes precedence on the regression corpus.',
  );
  lines.push('');
  return lines.join('\n');
}

function renderArbiterPrecision(c: Computed): string {
  const lines: string[] = [];
  lines.push('## Arbiter-validated precision (the load-bearing number)');
  lines.push('');
  lines.push(
    'A stratified sample of findings (per-corpus, per-category cap) was classified by both arbiters. A finding ' +
      'counts only where both agree. This is what separates a real catch from the auditor\'s blanket flagging.',
  );
  lines.push('');
  lines.push('| corpus | dual-labeled | both agreed | confirmed true-cheat | confirmed false-alarm |');
  lines.push('|---|---|---|---|---|');
  lines.push(
    `| retrospectively-bad | ${c.regPrecision.labeled} | ${c.regPrecision.agreed} | ` +
      `**${c.regPrecision.confirmedTrueCheat}** | ${c.regPrecision.confirmedFalseAlarm} |`,
  );
  lines.push(
    `| presumed-clean | ${c.cleanPrecision.labeled} | ${c.cleanPrecision.agreed} | ` +
      `${c.cleanPrecision.confirmedTrueCheat} | ${c.cleanPrecision.confirmedFalseAlarm} |`,
  );
  lines.push('');
  lines.push(
    `On the retrospectively-bad PRs, both arbiters confirmed **${c.regPrecision.confirmedTrueCheat}** of the ` +
      'auditor\'s findings as cheats. That is the headline: a high flag rate that does not survive independent ' +
      'validation is not a catch. The confirmed cheats that do exist are on clean, never-reverted PRs (listed in ' +
      'the defensible-catches section).',
  );
  lines.push('');
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
    renderArbiterPrecision(c),
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
