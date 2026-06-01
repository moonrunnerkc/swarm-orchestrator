// Build benchmarks/real-prs/REAL-WORLD-REPORT.md from the committed
// artifacts: the corpus, the pre/post audit results, the arbiter labels
// and rationale, the arbiter sanity number, the hand-review queue, and the
// cost ledger. Every number that rests on the arbiter is labeled
// "arbiter-labeled"; the arbiter is independent second-pass signal, not
// ground truth.
//
// Usage: node dist/scripts/real-prs/build-report.js

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { sliceDiffForFinding } from './lib/slice';
import {
  arbiterLabelsFile,
  arbiterRationaleFile,
  arbiterSanityFile,
  auditResultsDir,
  costFile,
  handReviewQueueFile,
  realPrsDir,
  reportFile,
  sourcesFile,
} from './lib/paths';
import type {
  ArbiterLabel,
  ArbiterRationale,
  ArbiterVerdict,
  AuditResultRecord,
  HarnessFinding,
  SourcePr,
  SourcesFile,
} from './lib/types';

const log = getLogger('real-prs:report');

const LEGIT: readonly ArbiterVerdict[] = ['true-cheat', 'debatable'];

interface CostSummaryShape {
  ceilingUsd: number;
  spentUsd: number;
  calls: number;
  perModel: Array<{ model: string; calls: number; usd: number }>;
}

function pct(numer: number, denom: number): string {
  if (denom === 0) return 'n/a';
  return `${((numer / denom) * 100).toFixed(1)}%`;
}

// The honest comparison on a presumed-clean corpus is the false-alarm
// burden per PR, in whichever direction the numbers actually fall.
function burdenVerdict(postPerPr: number, prePerPr: number): string {
  if (postPerPr <= prePerPr) {
    return (
      `On this unbiased corpus the post-upgrade auditor's false-alarm burden ` +
      `(${postPerPr.toFixed(2)}/PR) is at or below the pre-upgrade auditor's ` +
      `(${prePerPr.toFixed(2)}/PR): the post-upgrade changes do not make it noisier on real PRs.`
    );
  }
  return (
    `On this unbiased corpus the post-upgrade auditor's false-alarm burden rises from ` +
    `${prePerPr.toFixed(2)}/PR to ${postPerPr.toFixed(2)}/PR: the post-upgrade changes add ` +
    'noise on real PRs.'
  );
}

function loadRecords(): AuditResultRecord[] {
  const dir = auditResultsDir();
  const out: AuditResultRecord[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const repoDir of fs.readdirSync(dir)) {
    const full = path.join(dir, repoDir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const file of fs.readdirSync(full)) {
      if (file.endsWith('.json')) {
        out.push(JSON.parse(fs.readFileSync(path.join(full, file), 'utf8')) as AuditResultRecord);
      }
    }
  }
  return out;
}

function readSanityAgreement(): string {
  const f = arbiterSanityFile();
  if (!fs.existsSync(f)) return 'not run';
  const text = fs.readFileSync(f, 'utf8');
  const m = text.match(/Agreement:\s*\*\*([\d.]+%)\*\*\s*\(([^)]+)\)/);
  const r = text.match(/Result:\s*\*\*(PASS|FAIL)\*\*/);
  if (m === null) return 'unparsed';
  return `${m[1]} (${m[2]}), ${r?.[1] ?? '?'}`;
}

function arbiterModelOf(labels: ArbiterLabel[]): string {
  return labels[0]?.arbiterModel ?? 'unknown';
}

// Parse the hand-review queue for any rows the human labeled, and compute
// agreement with the arbiter on those rows. Returns null if nothing filled.
function handReviewDelta(
  labels: ArbiterLabel[],
): { matched: number; agreed: number } | null {
  const f = handReviewQueueFile();
  if (!fs.existsSync(f)) return null;
  const text = fs.readFileSync(f, 'utf8');
  const rows = text.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l));
  let matched = 0;
  let agreed = 0;
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    // | # | PR | category | path | judge-path | arbiter | conf | my-label |
    const prCell = cells[2] ?? '';
    const category = cells[3] ?? '';
    const arbiterVerdict = cells[6] ?? '';
    const myLabel = cells[8] ?? '';
    if (myLabel.length === 0) continue;
    matched += 1;
    if (myLabel === arbiterVerdict) agreed += 1;
    void prCell;
    void labels;
    void category;
  }
  return matched === 0 ? null : { matched, agreed };
}

function findingByKey(records: AuditResultRecord[]): Map<string, HarnessFinding> {
  const m = new Map<string, HarnessFinding>();
  for (const r of records) {
    for (const f of [...r.post, ...(r.pre ?? [])]) {
      if (!m.has(f.key)) m.set(f.key, f);
    }
  }
  return m;
}

function diffSnippetFor(
  finding: HarnessFinding,
  prByKey: Map<string, SourcePr>,
): string {
  const pr = prByKey.get(`${finding.repo}#${finding.prNumber}`);
  if (pr === undefined) return '(diff unavailable)';
  const abs = path.join(realPrsDir(), pr.diffPath);
  if (!fs.existsSync(abs)) return '(diff unavailable)';
  const diff = fs.readFileSync(abs, 'utf8');
  const slice = sliceDiffForFinding(diff, finding.subjectPath, finding.lineRange?.start ?? 1, 1_400);
  return slice;
}

function anchorBlock(
  title: string,
  picks: ArbiterLabel[],
  findings: Map<string, HarnessFinding>,
  rationale: Map<string, ArbiterRationale>,
  prByKey: Map<string, SourcePr>,
): string[] {
  const lines: string[] = [title, ''];
  if (picks.length === 0) {
    lines.push('_None in this run._', '');
    return lines;
  }
  picks.forEach((l, i) => {
    const f = findings.get(l.key);
    const r = rationale.get(l.key);
    const pr = prByKey.get(`${l.repo}#${l.prNumber}`);
    lines.push(`### ${i + 1}. ${l.repo}#${l.prNumber} — ${l.category} (${l.judgePath})`);
    if (pr !== undefined) lines.push(`PR: ${pr.url} — "${pr.title}"`);
    lines.push(`Arbiter: **${l.verdict}** (confidence ${l.confidence.toFixed(2)})`);
    if (f !== undefined) {
      lines.push('', `Finding: ${f.message}`);
      lines.push('', '```diff', diffSnippetFor(f, prByKey), '```');
    }
    if (r !== undefined && r.reasoning.length > 0) {
      lines.push('', `Arbiter reasoning: ${r.reasoning}`);
    }
    lines.push('');
  });
  return lines;
}

function main(): void {
  const sources = JSON.parse(fs.readFileSync(sourcesFile(), 'utf8')) as SourcesFile;
  const records = loadRecords();
  const labels: ArbiterLabel[] = fs.existsSync(arbiterLabelsFile())
    ? (JSON.parse(fs.readFileSync(arbiterLabelsFile(), 'utf8')) as ArbiterLabel[])
    : [];
  const rationaleArr: ArbiterRationale[] = fs.existsSync(arbiterRationaleFile())
    ? (JSON.parse(fs.readFileSync(arbiterRationaleFile(), 'utf8')) as ArbiterRationale[])
    : [];
  const labelByKey = new Map<string, ArbiterLabel>(labels.map((l) => [l.key, l]));
  const rationaleByKey = new Map<string, ArbiterRationale>(rationaleArr.map((r) => [r.key, r]));
  const findings = findingByKey(records);
  const prByKey = new Map<string, SourcePr>();
  for (const pr of sources.prs) prByKey.set(`${pr.repo}#${pr.prNumber}`, pr);

  const repos = [...new Set(sources.prs.map((p) => p.repo))];
  const nPrs = sources.prs.length;

  // Counts. A finding's legitimacy is the arbiter's verdict on its key.
  let postCount = 0;
  let preCount = 0;
  let preAvailable = 0;
  let postTrueCheat = 0;
  let postLegitDebatable = 0;
  let postFalse = 0;
  let postInsufficient = 0;
  let preFalse = 0;
  for (const r of records) {
    postCount += r.post.length;
    for (const f of r.post) {
      const v = labelByKey.get(f.key)?.verdict;
      if (v === 'true-cheat') postTrueCheat += 1;
      else if (v === 'debatable') postLegitDebatable += 1;
      else if (v === 'false-alarm') postFalse += 1;
      else if (v === 'insufficient-context') postInsufficient += 1;
    }
    if (r.pre !== null) {
      preAvailable += 1;
      preCount += r.pre.length;
      for (const f of r.pre) {
        const v = labelByKey.get(f.key)?.verdict;
        if (v === 'false-alarm') preFalse += 1;
      }
    }
  }
  const preUnavailable = records.length - preAvailable;

  // These are merged, reviewed PRs, so they are presumed clean: there is
  // little or nothing legitimate to catch, and almost every finding is a
  // false alarm by construction. The honest metric on this corpus is the
  // false-alarm burden (false alarms per PR), not recall.
  const postFalsePerPr = nPrs === 0 ? 0 : postFalse / nPrs;
  const preFalsePerPr = preAvailable === 0 ? 0 : preFalse / preAvailable;

  const lines: string[] = [];
  lines.push('# Real-world validation: does the auditor improve signal-to-noise on unbiased PRs?');
  lines.push('');
  lines.push(
    `Corpus: ${nPrs} merged PRs across ${repos.length} public repos (${repos.join(', ')}), ` +
      `fetched on ${sources.fetchedAt.slice(0, 10)} (see sources.json for each PR's head SHA). ` +
      `Arbiter: ${arbiterModelOf(labels)}, sanity-gate agreement ${readSanityAgreement()} ` +
      'against held-out oracle defects. The arbiter is an independent second-pass classifier, ' +
      'not ground truth; every number below that rests on it is arbiter-labeled.',
  );
  lines.push('');
  lines.push(
    'What this corpus measures: these are merged, reviewed PRs, so they are presumed clean. ' +
      'There is little or nothing legitimate to catch, so the corpus measures the false-alarm ' +
      'burden the auditor imposes on normal PRs, not its recall (there are no planted defects to ' +
      'recover here; recall is measured separately on the oracle corpus).',
  );
  lines.push('');
  lines.push(
    `Headline: the post-upgrade auditor raised **${postCount}** findings across ${nPrs} PRs ` +
      `(${(postCount / nPrs).toFixed(1)}/PR). The arbiter labeled **${postTrueCheat} true-cheat**, ` +
      `${postLegitDebatable} debatable, **${postFalse} false-alarm**, and ${postInsufficient} ` +
      `insufficient-context: a false-alarm rate of **${pct(postFalse, postCount)}** and a ` +
      `false-alarm burden of **${postFalsePerPr.toFixed(2)}/PR**. ` +
      (preUnavailable === records.length
        ? 'The pre-upgrade side was unavailable for this run (see below), so the side-by-side ' +
          'is not computed.'
        : `The pre-upgrade auditor raised **${preCount}** findings on the ${preAvailable} PRs ` +
          `where it ran (${preFalse} arbiter-labeled false-alarm, ` +
          `${preFalsePerPr.toFixed(2)}/PR). ` +
          burdenVerdict(postFalsePerPr, preFalsePerPr) +
          ' Recall against planted defects is a separate question (see the oracle benchmarks).'),
  );
  lines.push('');
  lines.push('Regenerate: `npm run real-prs:full`. Inputs: sources.json, audit-results/, ' +
    'arbiter-labels.json, arbiter-rationale.json, arbiter-sanity.md.');
  lines.push('');
  if (preUnavailable > 0) {
    lines.push(
      `> Pre-upgrade build note: the frozen pre-upgrade auditor was unavailable for ` +
        `${preUnavailable}/${records.length} PRs. Those PRs contribute to the post numbers but ` +
        'not to the side-by-side. The pre-upgrade build is produced by ' +
        '`scripts/real-prs/build-pre-upgrade.ts` from the last pre-oracle release tag.',
    );
    lines.push('');
  }

  // Per-repo table.
  lines.push('## Per-repo breakdown');
  lines.push('');
  lines.push('| repo | PRs | post findings | arbiter legit | arbiter false-alarm |');
  lines.push('|---|---|---|---|---|');
  for (const repo of repos.sort()) {
    const repoRecords = records.filter((r) => r.repo === repo);
    const post = repoRecords.flatMap((r) => r.post);
    const legit = post.filter((f) => {
      const v = labelByKey.get(f.key)?.verdict;
      return v !== undefined && LEGIT.includes(v);
    }).length;
    const fa = post.filter((f) => labelByKey.get(f.key)?.verdict === 'false-alarm').length;
    const prsForRepo = sources.prs.filter((p) => p.repo === repo).length;
    lines.push(`| ${repo} | ${prsForRepo} | ${post.length} | ${legit} | ${fa} |`);
  }
  lines.push('');

  // Per-category table with judge-path split.
  lines.push('## Per-category breakdown');
  lines.push('');
  lines.push('| category | post findings | structural | judge-confirm | judge-primary | arbiter legit | arbiter false-alarm |');
  lines.push('|---|---|---|---|---|---|---|');
  const allPost = records.flatMap((r) => r.post);
  const categories = [...new Set(allPost.map((f) => f.category))].sort();
  for (const category of categories) {
    const inCat = allPost.filter((f) => f.category === category);
    const structural = inCat.filter((f) => f.judgePath === 'structural').length;
    const confirm = inCat.filter((f) => f.judgePath === 'judge-confirm').length;
    const primary = inCat.filter((f) => f.judgePath === 'judge-primary').length;
    const legit = inCat.filter((f) => {
      const v = labelByKey.get(f.key)?.verdict;
      return v !== undefined && LEGIT.includes(v);
    }).length;
    const fa = inCat.filter((f) => labelByKey.get(f.key)?.verdict === 'false-alarm').length;
    lines.push(
      `| ${category} | ${inCat.length} | ${structural} | ${confirm} | ${primary} | ${legit} | ${fa} |`,
    );
  }
  lines.push('');

  // Anchors: 5 most defensible (true-cheat, highest confidence) and 5
  // worst false-alarms (false-alarm, highest confidence).
  const postKeys = new Set(allPost.map((f) => f.key));
  const postLabels = labels.filter((l) => postKeys.has(l.key));
  const trueCheats = postLabels
    .filter((l) => l.verdict === 'true-cheat')
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
  const falseAlarms = postLabels
    .filter((l) => l.verdict === 'false-alarm')
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
  lines.push(
    ...anchorBlock('## The 5 most defensible finds (arbiter-labeled true-cheat)', trueCheats, findings, rationaleByKey, prByKey),
  );
  lines.push(
    ...anchorBlock('## The 5 worst false alarms (arbiter-labeled false-alarm)', falseAlarms, findings, rationaleByKey, prByKey),
  );

  // Hand-review delta.
  lines.push('## Hand-review delta');
  lines.push('');
  const hr = handReviewDelta(labels);
  if (hr === null) {
    lines.push(
      'The hand-review queue (`hand-review-queue.md`) was not filled in, so the ' +
        'hand-review-vs-arbiter agreement is not computed. Fill in the `my-label` column and ' +
        're-run `npm run real-prs:report` to populate this section.',
    );
  } else {
    lines.push(
      `On the ${hr.matched} hand-labeled sample findings, the human and the arbiter agreed on ` +
        `**${hr.agreed}/${hr.matched}** (${pct(hr.agreed, hr.matched)}). This calibrates how far ` +
        'the arbiter labels can be trusted on this corpus.',
    );
  }
  lines.push('');

  // Cost and runtime footer.
  lines.push('## Cost and runtime');
  lines.push('');
  if (fs.existsSync(costFile())) {
    const cost = JSON.parse(fs.readFileSync(costFile(), 'utf8')) as CostSummaryShape;
    lines.push(
      `Arbiter API spend (list-price estimate): **$${cost.spentUsd.toFixed(2)}** of a ` +
        `$${cost.ceilingUsd.toFixed(2)} ceiling across ${cost.calls} calls ` +
        `(${cost.perModel.map((m) => `${m.model}: ${m.calls}`).join(', ')}).`,
    );
  } else {
    lines.push('No cost ledger on file (arbiter not yet run).');
  }
  lines.push('');
  lines.push('Regenerate the whole pipeline with `npm run real-prs:full`.');
  lines.push('');

  const out = reportFile();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join('\n') + '\n');
  log.info(`wrote report to ${out}`);
}

main();
