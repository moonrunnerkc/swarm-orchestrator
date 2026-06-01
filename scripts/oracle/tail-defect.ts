// Quantifies the tail-defect recovery from hunk-aware chunking. Embeds an
// empty-catch (error-swallow) defect in the tail of K synthetically large
// PRs, past the judge's head-truncation point, and asks the confirmation
// judge in two modes: head-truncate (the pre-change behavior) and chunked
// (the post-change behavior). Reports recall in each mode.
//
// Output: benchmarks/oracle-corpus/tail-defect-recovery.md
// Judge calls replay from benchmarks/judge-cache/cache.json.
//
// Usage: node dist/scripts/oracle/tail-defect.js [--count K] [--no-live]

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
): Promise<boolean> {
  for (const chunk of chunkUnifiedDiff(diff, MAX_JUDGE_DIFF_CHARS)) {
    const user = buildConfirmationPrompt('error-swallow', 'fix persistence', chunk);
    const a = await judge.ask(systemPrompt, user, live);
    if (a.answer === 'yes') return true;
  }
  return false;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const live = !argv.includes('--no-live');
  // --localized swaps the chunked path to the localized confirm prompt
  // (the experiment that decides whether a less-conservative single-hunk
  // prompt lifts tail-defect recall). Whole-diff / head-truncate stays on
  // the conservative prompt.
  const localized = argv.includes('--localized');
  const chunkedSystem = localized ? LOCALIZED_CONFIRM_SYSTEM_PROMPT : CONFIRM_SYSTEM_PROMPT;
  const countArg = argv.indexOf('--count');
  const count = countArg !== -1 ? Number(argv[countArg + 1]) : 10;
  loadDotenv();
  const root = repoRoot();
  const cache = new JudgeCache(root);
  const judge = new BenchJudge(cache);

  let headHits = 0;
  let chunkHits = 0;
  for (let seed = 0; seed < count; seed += 1) {
    const diff = bigDiffWithTailDefect(seed);
    if (await judgeHeadTruncate(judge, diff, live)) headHits += 1;
    if (await judgeChunked(judge, diff, live, chunkedSystem)) chunkHits += 1;
  }
  cache.flush();

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
  // A --localized measurement run does not overwrite the committed v1
  // report; it only prints the number so the experiment can be judged.
  if (!localized) {
    fs.writeFileSync(path.join(root, 'benchmarks', 'oracle-corpus', 'tail-defect-recovery.md'), `${lines.join('\n')}\n`);
  }
  process.stdout.write(
    `tail-defect: head=${headHits}/${count} chunk=${chunkHits}/${count} ` +
      `prompt=${localized ? 'localized' : 'conservative'}\n`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`tail-defect: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}

export { main };
