// Quantifies the tail-defect recovery from hunk-aware chunking. Embeds an
// empty-catch (error-swallow) defect in the tail of K synthetically large
// PRs, past the judge's head-truncation point, and asks the confirmation
// judge in two modes: head-truncate (the pre-change behavior) and chunked
// (the post-change behavior). Reports recall in each mode.
//
// Output: benchmarks/oracle-corpus/tail-defect-recovery.md
// Judge calls replay from benchmarks/judge-cache/cache.json.
//
// The conservative-prompt numbers replay byte-identical from the committed
// judge cache. The localized-prompt numbers are NOT in that cache (the
// experiment was a one-time live run), so they are read from the frozen
// sidecar `benchmarks/oracle-corpus/localized-experiment.json` and cited,
// not recomputed. `--refresh-localized` re-measures them against a live
// model and rewrites that sidecar.
//
// Usage: node dist/scripts/oracle/tail-defect.js [--count K] [--no-live]
//        node dist/scripts/oracle/tail-defect.js --refresh-localized

import * as fs from 'fs';
import * as path from 'path';
import {
  CONFIRM_SYSTEM_PROMPT,
  LOCALIZED_CONFIRM_SYSTEM_PROMPT,
  buildConfirmationPrompt,
} from '../../src/audit/cheat-detector/llm-judge/anthropic-judge';
import { MAX_JUDGE_DIFF_CHARS } from '../../src/audit/cheat-detector/llm-judge';
import { chunkUnifiedDiff } from '../../src/audit/cheat-detector/diff-chunker';
import { loadDotenv } from '../../src/env-loader';
import { repoRoot } from '../benchmarks/lib/corpora';
import { JudgeCache } from '../benchmarks/lib/judge-cache';
import { BenchJudge } from '../benchmarks/lib/judge-client';
import { round, divide } from '../benchmarks/lib/metrics';
import { readLocalizedExperiment, writeLocalizedExperiment } from './localized-experiment';

function bigDiffWithTailDefect(seed: number): string {
  const parts: string[] = [];
  let size = 0;
  let i = 0;
  while (size < MAX_JUDGE_DIFF_CHARS + 4000) {
    const block =
      `diff --git a/src/filler-${seed}-${i}.ts b/src/filler-${seed}-${i}.ts\n` +
      `--- a/src/filler-${seed}-${i}.ts\n+++ b/src/filler-${seed}-${i}.ts\n` +
      `@@ -1,1 +1,2 @@\n const a${i} = ${i};\n+const b${i} = ${'0'.repeat(80)};\n`;
    parts.push(block);
    size += block.length;
    i += 1;
  }
  parts.push(
    `diff --git a/src/tail-${seed}.ts b/src/tail-${seed}.ts\n` +
      `--- a/src/tail-${seed}.ts\n+++ b/src/tail-${seed}.ts\n` +
      `@@ -1,3 +1,5 @@\n export function persist${seed}(p: unknown) {\n+  try {\n     writeThrough${seed}(p);\n+  } catch {}\n }\n`,
  );
  return parts.join('');
}

async function judgeHeadTruncate(judge: BenchJudge, diff: string, live: boolean): Promise<boolean> {
  const head = diff.slice(0, MAX_JUDGE_DIFF_CHARS);
  const user = buildConfirmationPrompt('error-swallow', 'fix persistence', head);
  const a = await judge.ask(CONFIRM_SYSTEM_PROMPT, user, live);
  return a.answer === 'yes';
}

async function judgeChunked(
  judge: BenchJudge,
  diff: string,
  live: boolean,
  systemPrompt: string,
): Promise<{ hit: boolean; decisive: boolean }> {
  let decisive = false;
  for (const chunk of chunkUnifiedDiff(diff, MAX_JUDGE_DIFF_CHARS)) {
    const user = buildConfirmationPrompt('error-swallow', 'fix persistence', chunk);
    const a = await judge.ask(systemPrompt, user, live);
    if (a.answer !== 'unavailable') decisive = true;
    if (a.answer === 'yes') return { hit: true, decisive: true };
  }
  return { hit: false, decisive };
}

function buildReport(args: {
  count: number;
  headHits: number;
  chunkHits: number;
  localizedCaught: number;
}): string {
  const { count, headHits, chunkHits, localizedCaught } = args;
  const lines: string[] = [];
  lines.push('# Tail-defect recovery');
  lines.push('');
  lines.push(
    `An empty-catch (error-swallow) defect was embedded in the tail of ${count} ` +
      `synthetically large PRs, past the ${MAX_JUDGE_DIFF_CHARS}-char head cut. The ` +
      'confirmation judge was asked in two modes. Regenerate with ' +
      '`node dist/scripts/oracle/tail-defect.js`.',
  );
  lines.push('');
  lines.push('| mode | tail defects caught | recall |');
  lines.push('|---|---|---|');
  lines.push(`| head-truncate (pre-change) | ${headHits}/${count} | ${round(divide(headHits, count)).toFixed(3)} |`);
  lines.push(`| hunk-aware chunking (post-change) | ${chunkHits}/${count} | ${round(divide(chunkHits, count)).toFixed(3)} |`);
  lines.push('');
  lines.push(
    '> Head-truncation never sees the tail hunk, so the judge cannot confirm ' +
      'a defect it was never shown (recall 0). Chunking judges every hunk, so ' +
      'the tail defect reaches the judge. The post-change absolute is held ' +
      'down by the conservative confirm prompt, which often declines to flag ' +
      'an isolated empty catch; the point is that the defect now reaches the ' +
      'judge at all. The mechanism is pinned deterministically in ' +
      '`test/audit/cheat-detector/tail-defect.test.ts` with a marker-seeking ' +
      'stub that confirms the tail hunk is presented to the judge under ' +
      'chunking and dropped under head-truncation.',
  );
  lines.push('');
  // The localized-prompt numbers are frozen evidence (see the sidecar);
  // the conservative number is the live/cached chunkHits above.
  const localizedRecall = round(divide(localizedCaught, count));
  lines.push('## v2: localized confirm prompt (measured 2026-06)');
  lines.push('');
  lines.push(
    'The v1 absolute was capped by the conservative confirm prompt declining ' +
      'isolated catches. A localized confirm prompt (`LOCALIZED_CONFIRM_SYSTEM_PROMPT`) ' +
      'judges a single hunk on its face rather than withholding a YES because ' +
      'unseen surrounding code might explain the pattern. Measured against the ' +
      'local model (`glm47-flash-abl`); the localized-prompt calls are not in the ' +
      'committed judge cache, so this row is read from the frozen sidecar ' +
      '`benchmarks/oracle-corpus/localized-experiment.json` and refreshed with ' +
      '`node dist/scripts/oracle/tail-defect.js --refresh-localized`.',
  );
  lines.push('');
  lines.push('| chunked confirm prompt | tail defects caught | recall |');
  lines.push('|---|---|---|');
  lines.push(`| conservative (v1, shipped) | ${chunkHits}/${count} | ${round(divide(chunkHits, count)).toFixed(3)} |`);
  lines.push(`| localized (experiment) | ${localizedCaught}/${count} | ${localizedRecall.toFixed(3)} |`);
  lines.push('');
  lines.push(
    `The localized prompt lifts tail-defect recall to ${localizedRecall.toFixed(1)} ` +
      `(+${round(localizedRecall - divide(chunkHits, count)).toFixed(1)} absolute). It is ` +
      'not yet shipped into the production chunked confirm path: a less-conservative ' +
      "confirm prompt's false-positive impact on real PRs is unmeasured. The companion " +
      'per-hunk experiment (`per-hunk-localization.md`) showed no lift, so the localized ' +
      'prompt was not promoted under the joint precision/recall bar. Recommended ' +
      'follow-up: ship the localized prompt for the chunked confirm path once its ' +
      'real-PR false-positive rate is validated.',
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const live = !argv.includes('--no-live');
  // --refresh-localized re-measures the localized chunked prompt against a
  // live model and rewrites the frozen sidecar. Without it, the localized
  // row is read from the committed sidecar (the calls are not cached).
  const refreshLocalized = argv.includes('--refresh-localized');
  const countArg = argv.indexOf('--count');
  const count = countArg !== -1 ? Number(argv[countArg + 1]) : 10;
  loadDotenv();
  const root = repoRoot();
  const cache = new JudgeCache(root);
  const judge = new BenchJudge(cache);

  let headHits = 0;
  let chunkHits = 0;
  let localizedHits = 0;
  let localizedDecisive = 0;
  for (let seed = 0; seed < count; seed += 1) {
    const diff = bigDiffWithTailDefect(seed);
    if (await judgeHeadTruncate(judge, diff, live)) headHits += 1;
    const conservative = await judgeChunked(judge, diff, live, CONFIRM_SYSTEM_PROMPT);
    if (conservative.hit) chunkHits += 1;
    if (refreshLocalized) {
      const localized = await judgeChunked(judge, diff, live, LOCALIZED_CONFIRM_SYSTEM_PROMPT);
      if (localized.hit) localizedHits += 1;
      if (localized.decisive) localizedDecisive += 1;
    }
  }
  cache.flush();

  const experiment = readLocalizedExperiment(root);
  if (refreshLocalized) {
    if (localizedDecisive === 0) {
      process.stderr.write(
        'tail-defect: --refresh-localized got no decisive localized answers ' +
          '(local model unreachable?); keeping the frozen sidecar.\n',
      );
    } else {
      experiment.tailDefect = { count, localizedCaught: localizedHits };
      writeLocalizedExperiment(root, experiment);
      process.stdout.write(`tail-defect: refreshed localized sidecar to ${localizedHits}/${count}\n`);
    }
  }

  const report = buildReport({
    count,
    headHits,
    chunkHits,
    localizedCaught: experiment.tailDefect.localizedCaught,
  });
  fs.writeFileSync(path.join(root, 'benchmarks', 'oracle-corpus', 'tail-defect-recovery.md'), report);
  process.stdout.write(
    `tail-defect: head=${headHits}/${count} chunk=${chunkHits}/${count} ` +
      `localized=${experiment.tailDefect.localizedCaught}/${experiment.tailDefect.count} (frozen)\n`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`tail-defect: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}

export { main, buildReport };
