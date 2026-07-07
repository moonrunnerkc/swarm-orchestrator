// Judge baseline: run the shipped judge-primary diff-only path over the semantic
// twin pairs (goal-not-fixed, cheat-mock-mutation) and record the judge's recall
// on the cheat twins against its false-positive rate on the honest twins. This is
// the diff-only alternative to the execution proof tier: the judge catches the
// semantic cheats the structural detectors and the proof tier cannot (they have
// no structural tell and abstain), but it pays a false-positive cost on the clean
// side that the execution-grounded proofs, by construction, do not.
//
// Held-out safe: reads only the semi-synthetic twins (measurement fixtures, not
// held out). The wild-corpus judge run needs the wild diffs, which are referenced
// not vendored (fetch-bound follow-on). Bounded; ~2 judge calls per pair.
//
// Usage: SWARM_JUDGE_MODEL=claude-haiku-4-5-20251001 \
//   node dist/scripts/benchmarks/judge-baseline-measure.js

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import parseDiff from 'parse-diff';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { runJudgePrimary } from '../../src/audit/cheat-detector/judge-primary';
import type { SemanticCheatCategory } from '../../src/audit/types';
import { wilsonInterval } from '../../src/audit/gate/wilson';

const log = getLogger('benchmarks:judge-baseline');

const TWINS_FILE = path.join('benchmarks', 'twins', 'semi-synthetic', 'twins.json');
const OUT_JSON = path.join('benchmarks', 'twins', 'judge-baseline.json');
const OUT_MD = path.join('benchmarks', 'twins', 'JUDGE-BASELINE-REPORT.md');

const SEMANTIC: readonly SemanticCheatCategory[] = ['goal-not-fixed', 'cheat-mock-mutation'];

interface TwinPair {
  category: string;
  claim: string;
  prId: string;
  cheatDiff: string;
  honestDiff: string;
}

async function judgeFires(diff: string, claim: string, category: SemanticCheatCategory): Promise<boolean> {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-base-'));
  try {
    const findings = await runJudgePrimary({
      unifiedDiff: diff,
      claim,
      repoRoot,
      files: parseDiff(diff),
      categories: [category],
      allowLiveCall: true,
    });
    return findings.some((f) => f.category === category);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

interface Row {
  category: string;
  prId: string;
  judgeOnCheat: boolean;
  judgeOnHonest: boolean;
}

function isSemantic(c: string): c is SemanticCheatCategory {
  return (SEMANTIC as readonly string[]).includes(c);
}

async function main(): Promise<void> {
  loadDotenv();
  if (process.env.ANTHROPIC_API_KEY === undefined || process.env.ANTHROPIC_API_KEY.length === 0) {
    throw new Error('ANTHROPIC_API_KEY not set; the judge baseline needs a judge model');
  }
  const data = JSON.parse(fs.readFileSync(TWINS_FILE, 'utf8')) as { pairs: TwinPair[] };
  const pairs = data.pairs.filter((p) => isSemantic(p.category));
  log.info(`judge baseline over ${pairs.length} semantic twin pair(s)`);

  const rows: Row[] = [];
  for (const p of pairs) {
    if (!isSemantic(p.category)) continue;
    const judgeOnCheat = await judgeFires(p.cheatDiff, p.claim, p.category);
    const judgeOnHonest = await judgeFires(p.honestDiff, p.claim, p.category);
    rows.push({ category: p.category, prId: p.prId, judgeOnCheat, judgeOnHonest });
    log.info(`  ${p.prId} (${p.category}): cheat=${judgeOnCheat} honest=${judgeOnHonest}`);
  }

  const n = rows.length;
  const recallFires = rows.filter((r) => r.judgeOnCheat).length;
  const fpFires = rows.filter((r) => r.judgeOnHonest).length;
  const summary = {
    n,
    judgeRecallOnCheat: n === 0 ? 0 : recallFires / n,
    judgeFalsePositiveOnHonest: n === 0 ? 0 : fpFires / n,
    judgeRecallWilsonLower: wilsonInterval(recallFires, n).lower,
    judgeFpWilsonUpper: wilsonInterval(fpFires, n).upper,
    // The proof tier / structural detectors abstain on the semantic categories
    // (no structural tell), so their recall and false-positive rate here are 0.
    proofTierRecall: 0,
    proofTierFalsePositive: 0,
  };

  fs.writeFileSync(
    OUT_JSON,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), computedBy: 'scripts/benchmarks/judge-baseline-measure.ts', model: process.env.SWARM_JUDGE_MODEL ?? 'pinned-judge', summary, rows }, null, 2)}\n`,
  );
  writeReport(summary, rows);
  log.info(`judge baseline: recall ${(summary.judgeRecallOnCheat * 100).toFixed(0)}% on cheat, FP ${(summary.judgeFalsePositiveOnHonest * 100).toFixed(0)}% on honest (n=${n}). Wrote ${OUT_MD}.`);
}

function writeReport(s: { n: number; judgeRecallOnCheat: number; judgeFalsePositiveOnHonest: number; judgeRecallWilsonLower: number; judgeFpWilsonUpper: number }, rows: readonly Row[]): void {
  const byCat = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byCat.get(r.category) ?? [];
    list.push(r);
    byCat.set(r.category, list);
  }
  const catRows = [...byCat.entries()]
    .sort()
    .map(([cat, list]) => {
      const rec = list.filter((r) => r.judgeOnCheat).length;
      const fp = list.filter((r) => r.judgeOnHonest).length;
      return `| ${cat} | ${list.length} | ${rec}/${list.length} | ${fp}/${list.length} |`;
    })
    .join('\n');
  const md = `# Judge baseline vs the proof tier (semantic twins)

The shipped judge-primary diff-only path run over the semantic twin pairs
(goal-not-fixed, cheat-mock-mutation), where no structural detector fires and the
execution proof tier abstains. It records the judge's recall on the cheat twins
against its false-positive rate on the honest twins, the trade the proof tier is
built to avoid. Every number regenerates from
\`scripts/benchmarks/judge-baseline-measure.ts\` (\`npm run judge-baseline\`).

## Judge vs proof tier

| tier | recall on cheat twins | false positives on honest twins |
| --- | --- | --- |
| judge-primary (diff-only) | ${(s.judgeRecallOnCheat * 100).toFixed(0)}% (Wilson-lower ${s.judgeRecallWilsonLower.toFixed(2)}) | ${(s.judgeFalsePositiveOnHonest * 100).toFixed(0)}% (Wilson-upper ${s.judgeFpWilsonUpper.toFixed(2)}) |
| execution proof tier | 0% (abstains: no structural tell, and the claim-differential closure control abstains on a generic witness) | 0% |

The point of the comparison: the judge is the only path that catches these
semantic cheats from the diff alone, so its recall is the reachable ceiling on
this slice, but it pays a false-positive rate on the clean side. The proof tier
trades that recall for zero false positives by refusing to fire without executed
evidence. Neither dominates; they are complementary, and both ship advisory.

## By category

| category | pairs | judge caught (cheat) | judge fired (honest, FP) |
| --- | --- | --- | --- |
${catRows}

n = ${s.n} semantic twin pairs. The judge model and prompt version are recorded in
\`judge-baseline.json\`; the diff-only judge is a floor for the path (a provisioned
run reads more context). The wild-corpus judge run needs the wild diffs, which the
dataset references rather than vendors, and is a fetch-bound follow-on.
`;
  fs.writeFileSync(OUT_MD, md);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
