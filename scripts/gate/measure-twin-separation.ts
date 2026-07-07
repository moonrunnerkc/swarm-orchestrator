// Paired twin-separation measurement. For each cheat/honest twin pair, run the
// advisory detector tier (diff-only, deterministic) on both halves and record
// whether the pair's category fired on each. The paired separation per category
// is P(fire on cheat twin) - P(fire on honest twin); the exact McNemar test says
// whether the discordant pairs favor the cheat direction. Tiers (semi-synthetic,
// wild-pair) are reported separately, never blended.
//
// This measures the DETECTOR tier, which needs no provisioning. The
// execution-grounded proof tier and claim-differential separation over the same
// pairs is bounded by the 12-Node provisioning limit (see EG-VIABILITY-POLYGLOT-
// REPORT.md) and is recorded as follow-on, not run here.
//
// The detector tier is advisory (PR-level precision ~0.22 against outcome labels),
// so a fire on an honest twin is a recorded advisory false positive, not the
// block-tier stop-the-line: that rule is reserved for a PROVEN trigger, which this
// diff-only measurement does not exercise. Honest-twin fires are listed so the
// advisory FP rate on the clean side is visible per category.
//
// Usage: node dist/scripts/gate/measure-twin-separation.js

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import { getLogger } from '../../src/logger';
import { mcNemarExact, pairedSeparation } from '../../src/audit/gate/mcnemar';
import { wilsonInterval } from '../../src/audit/gate/wilson';

const log = getLogger('gate:twin-separation');

const TWINS_DIR = path.join('benchmarks', 'twins');
const OUT_JSON = path.join(TWINS_DIR, 'twin-separation.json');
const OUT_MD = path.join(TWINS_DIR, 'TWIN-SEPARATION-REPORT.md');

interface TwinPair {
  tier: 'semi-synthetic' | 'wild-pair';
  category: string;
  prId: string;
  sourcePrUrl: string;
  cheatDiff: string;
  honestDiff: string;
}

interface PairOutcome {
  tier: string;
  category: string;
  prId: string;
  cheat: boolean;
  honest: boolean;
}

function repoFromUrl(url: string): string {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\//);
  return m?.[1] ?? 'owner/repo';
}

async function fires(diff: string, category: string, repository: string): Promise<boolean> {
  const manifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-sep-'));
  try {
    const audit = await runCheatDetectors({
      unifiedDiff: diff,
      repoRoot: manifestDir,
      pr: { number: 0, headSha: '', baseSha: '', title: '', body: '', author: '', headRef: '', repository },
    });
    return audit.findings.some((f) => f.category === category);
  } finally {
    fs.rmSync(manifestDir, { recursive: true, force: true });
  }
}

function loadTier(file: string): TwinPair[] {
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { pairs?: TwinPair[] };
  return data.pairs ?? [];
}

interface CategoryStat {
  tier: string;
  category: string;
  n: number;
  cheatFireRate: number;
  honestFireRate: number;
  separation: number;
  mcNemarP: number;
  cheatWilsonLower: number;
  honestFalsePositives: number;
}

function summarize(outcomes: readonly PairOutcome[]): { byCategory: CategoryStat[]; overall: Record<string, CategoryStat> } {
  const groups = new Map<string, PairOutcome[]>();
  for (const o of outcomes) {
    const key = `${o.tier}::${o.category}`;
    const list = groups.get(key) ?? [];
    list.push(o);
    groups.set(key, list);
  }
  const byCategory: CategoryStat[] = [];
  for (const [key, list] of [...groups.entries()].sort()) {
    const [tier, category] = key.split('::');
    const sep = pairedSeparation(list);
    const mc = mcNemarExact(list);
    const cheatFires = list.filter((o) => o.cheat).length;
    byCategory.push({
      tier: tier!,
      category: category!,
      n: list.length,
      cheatFireRate: sep.cheatFireRate,
      honestFireRate: sep.honestFireRate,
      separation: sep.separation,
      mcNemarP: mc.pValueExact,
      cheatWilsonLower: wilsonInterval(cheatFires, list.length).lower,
      honestFalsePositives: list.filter((o) => o.honest).length,
    });
  }
  const overall: Record<string, CategoryStat> = {};
  const byTier = new Map<string, PairOutcome[]>();
  for (const o of outcomes) {
    const list = byTier.get(o.tier) ?? [];
    list.push(o);
    byTier.set(o.tier, list);
  }
  for (const [tier, list] of byTier) {
    const sep = pairedSeparation(list);
    const mc = mcNemarExact(list);
    const cheatFires = list.filter((o) => o.cheat).length;
    overall[tier] = {
      tier,
      category: '(all)',
      n: list.length,
      cheatFireRate: sep.cheatFireRate,
      honestFireRate: sep.honestFireRate,
      separation: sep.separation,
      mcNemarP: mc.pValueExact,
      cheatWilsonLower: wilsonInterval(cheatFires, list.length).lower,
      honestFalsePositives: list.filter((o) => o.honest).length,
    };
  }
  return { byCategory, overall };
}

async function main(): Promise<void> {
  const semi = loadTier(path.join(TWINS_DIR, 'semi-synthetic', 'twins.json'));
  const wild = loadTier(path.join(TWINS_DIR, 'wild-pair', 'twins.json'));
  const pairs = [...semi, ...wild];
  if (pairs.length === 0) {
    throw new Error('no twin pairs found; run `npm run twins:build` first');
  }
  log.info(`measuring detector-tier separation over ${pairs.length} twin pair(s)`);

  const outcomes: PairOutcome[] = [];
  for (const p of pairs) {
    const repo = repoFromUrl(p.sourcePrUrl);
    const cheat = await fires(p.cheatDiff, p.category, repo);
    const honest = await fires(p.honestDiff, p.category, repo);
    outcomes.push({ tier: p.tier, category: p.category, prId: p.prId, cheat, honest });
  }

  const { byCategory, overall } = summarize(outcomes);
  const honestFires = outcomes.filter((o) => o.honest);
  const out = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/gate/measure-twin-separation.ts',
    note:
      'Paired detector-tier separation over cheat/honest twins. The execution proof tier and ' +
      'claim-differential separation over the same pairs is provisioning-bound and recorded as ' +
      'follow-on, not run here. The detector tier is advisory, so an honest-twin fire is a recorded ' +
      'advisory false positive, not the block-tier stop-the-line (which applies only to proven triggers).',
    tiers: Object.keys(overall).sort(),
    overall,
    byCategory,
    honestTwinFalsePositives: honestFires.map((o) => ({ tier: o.tier, category: o.category, prId: o.prId })),
  };
  fs.mkdirSync(TWINS_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(out, null, 2)}\n`);
  writeReport(byCategory, overall, honestFires.length);
  log.info(
    `twin-separation: ${outcomes.length} pairs; ${honestFires.length} advisory honest-twin false positive(s) ` +
      `(the detector tier is advisory; not the block-tier stop-the-line). Wrote ${OUT_JSON} and ${OUT_MD}.`,
  );
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function writeReport(byCategory: readonly CategoryStat[], overall: Record<string, CategoryStat>, honestFp: number): void {
  const overallRows = Object.values(overall)
    .map((s) => `| ${s.tier} | ${s.n} | ${pct(s.cheatFireRate)} | ${pct(s.honestFireRate)} | ${s.separation.toFixed(2)} | ${s.mcNemarP.toFixed(4)} |`)
    .join('\n');
  const catRows = byCategory
    .map((s) => `| ${s.tier} | ${s.category} | ${s.n} | ${pct(s.cheatFireRate)} | ${pct(s.honestFireRate)} | ${s.separation.toFixed(2)} | ${s.honestFalsePositives} |`)
    .join('\n');
  const md = `# Twin separation: detector tier

Paired separation of the advisory detector tier over cheat/honest twins. Each pair
shares a source PR: the cheat twin has an injected defect, the honest twin is the
untouched clean change. Separation is P(fire on cheat) - P(fire on honest);
McNemar's exact test uses only the discordant pairs. Tiers are reported separately.
Every number regenerates from \`scripts/gate/measure-twin-separation.ts\`
(\`npm run twins:separation\`).

Scope: this is the DETECTOR tier (diff-only, deterministic, no provisioning). The
execution-grounded proof tier and the claim-differential separation over the same
pairs are bounded by the 12-Node provisioning limit and are recorded as follow-on.

## Overall by tier

| tier | pairs | cheat fire rate | honest fire rate | separation | McNemar p |
| --- | --- | --- | --- | --- | --- |
${overallRows}

## By category

| tier | category | pairs | cheat fire | honest fire | separation | honest FPs |
| --- | --- | --- | --- | --- | --- | --- |
${catRows}

## Honest-twin false positives

${honestFp === 0
      ? 'None. No detector fired on an honest twin: the detector tier separated every cheat twin from its legitimate counterpart without a false positive on the clean side.'
      : `${honestFp} honest-twin fire(s) recorded above. The detector tier is advisory (PR-level precision ~0.22 against outcome labels), so these are expected advisory false positives on the clean side, recorded per category. They are NOT the block-tier stop-the-line, which applies only to a proven trigger; this diff-only measurement runs no proof.`}

## Two honest caveats

- **Semantic categories** (goal-not-fixed, cheat-mock-mutation) have no structural
  tell, so the diff-only detector tier does not fire on them by design; their
  separation is measured through the judge path, reported separately in the judge
  baseline. A zero here is expected, not a miss.
- **Diff-only harness.** This runs the detectors on the diff alone with a bare
  manifest directory, so a few structural categories whose detector needs more
  than the isolated hunk (comment-only-fix, dead-branch-insertion,
  exception-rethrow-lost-context) can read zero here even though the oracle's own
  scoring harness (with manifests and config) catches them at 258/275. Those rows
  are a harness floor, not a recall claim; the categories that fire show the real
  separation.
`;
  fs.writeFileSync(OUT_MD, md);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
