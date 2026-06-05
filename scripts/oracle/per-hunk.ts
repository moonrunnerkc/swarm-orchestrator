// Measures per-hunk judge localization. Builds K multi-hunk PRs, each with
// a mock-of-hallucination defect in one known hunk and benign changes in
// the others, and judges in two modes:
//   - whole-diff: one verdict for the entire diff (cannot point at a hunk)
//   - per-hunk:   judge each hunk and report which hunk triggered the yes
// Localization accuracy is the fraction of injections whose verdict lands
// on the correct hunk and nowhere else.
//
// Output: benchmarks/oracle-corpus/per-hunk-localization.md
//
// The conservative-prompt numbers replay byte-identical from the committed
// judge cache. The localized-prompt numbers are NOT in that cache (a
// one-time live run), so they are read from the frozen sidecar
// `benchmarks/oracle-corpus/localized-experiment.json` and cited, not
// recomputed. `--refresh-localized` re-measures them against a live model.
//
// Usage: node dist/scripts/oracle/per-hunk.js [--count K] [--no-live]
//        node dist/scripts/oracle/per-hunk.js --refresh-localized

import * as fs from 'fs';
import * as path from 'path';
import {
  CONFIRM_SYSTEM_PROMPT,
  LOCALIZED_CONFIRM_SYSTEM_PROMPT,
  buildConfirmationPrompt,
} from '../../src/audit/cheat-detector/llm-judge/anthropic-judge';
import { chunkUnifiedDiffByHunk } from '../../src/audit/cheat-detector/diff-chunker';
import { loadDotenv } from '../../src/env-loader';
import { repoRoot } from '../benchmarks/lib/corpora';
import { JudgeCache } from '../benchmarks/lib/judge-cache';
import { BenchJudge } from '../benchmarks/lib/judge-client';
import { round, divide } from '../benchmarks/lib/metrics';
import { readLocalizedExperiment, writeLocalizedExperiment } from './localized-experiment';

function benignHunk(file: string, seed: number, k: number): string {
  return (
    `diff --git a/src/${file} b/src/${file}\n--- a/src/${file}\n+++ b/src/${file}\n` +
    `@@ -1,2 +1,3 @@\n it('reads base${seed}_${k}', () => {\n` +
    `   expect(read${seed}_${k}()).toBe(${k});\n` +
    `+  expect(read${seed}_${k}()).toBeDefined();\n`
  );
}

function defectHunk(file: string, seed: number): string {
  // A jest.mock of an invented package: the judge reliably calls this a
  // hallucinated mock, so the per-hunk verdict is well defined.
  return (
    `diff --git a/src/${file} b/src/${file}\n--- a/src/${file}\n+++ b/src/${file}\n` +
    `@@ -1,2 +1,3 @@\n import { thing } from './thing';\n` +
    ` it('uses thing', () => { expect(thing()).toBe(1); });\n` +
    `+jest.mock('imaginary-vendor-sdk-${seed}');\n`
  );
}

// A multi-hunk diff with the defect at a deterministic position. Returns
// the diff and the (file, hunkIndex) of the injected defect.
function buildCase(seed: number): { diff: string; defectFile: string; defectHunkIndex: number } {
  const defectPos = seed % 4; // 0..3
  const blocks: string[] = [];
  let defectFile = '';
  for (let k = 0; k < 4; k += 1) {
    if (k === defectPos) {
      const file = `mod${seed}_${k}.ts`;
      defectFile = file;
      blocks.push(defectHunk(file, seed));
    } else {
      blocks.push(benignHunk(`mod${seed}_${k}.ts`, seed, k));
    }
  }
  return { diff: blocks.join(''), defectFile, defectHunkIndex: 0 };
}

interface PerHunkTally {
  defectHunkFlagged: number;
  benignHunkFalse: number;
  pointedCorrectly: number;
  decisive: number;
}

async function measurePerHunk(
  judge: BenchJudge,
  count: number,
  live: boolean,
  perHunkSystem: string,
): Promise<PerHunkTally> {
  const tally: PerHunkTally = {
    defectHunkFlagged: 0,
    benignHunkFalse: 0,
    pointedCorrectly: 0,
    decisive: 0,
  };
  for (let seed = 0; seed < count; seed += 1) {
    const c = buildCase(seed);
    let defectYes = false;
    let benignYes = false;
    for (const hunk of chunkUnifiedDiffByHunk(c.diff)) {
      const user = buildConfirmationPrompt('mock-of-hallucination', 'add tests', hunk.text);
      const a = await judge.ask(perHunkSystem, user, live);
      if (a.answer !== 'unavailable') tally.decisive += 1;
      if (a.answer !== 'yes') continue;
      if (hunk.file === c.defectFile && hunk.hunkIndex === c.defectHunkIndex) defectYes = true;
      else benignYes = true;
    }
    if (defectYes) tally.defectHunkFlagged += 1;
    if (benignYes) tally.benignHunkFalse += 1;
    if (defectYes && !benignYes) tally.pointedCorrectly += 1;
  }
  return tally;
}

function buildReport(args: {
  count: number;
  wholeFlagged: number;
  conservative: PerHunkTally;
  localizedDefectFlagged: number;
  localizedPointedCorrectly: number;
  localizedBenignFalse: number;
}): string {
  const { count, wholeFlagged, conservative } = args;
  const lines: string[] = [];
  lines.push('# Per-hunk judge localization');
  lines.push('');
  lines.push(
    `${count} multi-hunk PRs, each with a mock-of-hallucination defect in one ` +
      'known hunk and benign changes in the rest. Whole-diff judging returns one ' +
      'verdict for the entire diff and cannot point at a hunk; per-hunk judging ' +
      'judges each hunk under a stable (file, hunk-index) id and localizes the ' +
      'verdict. Regenerate with `node dist/scripts/oracle/per-hunk.js`.',
  );
  lines.push('');
  lines.push('| mode | flags the diff | localizes to a hunk | points only at the defect hunk |');
  lines.push('|---|---|---|---|');
  lines.push(`| whole-diff | ${wholeFlagged}/${count} | never (no hunk id) | 0/${count} |`);
  lines.push(
    `| per-hunk | ${conservative.defectHunkFlagged}/${count} (defect hunk) | yes | ${conservative.pointedCorrectly}/${count} |`,
  );
  lines.push('');
  lines.push(
    '> Whole-diff judging returns one verdict for the whole diff, so it can ' +
      'never point at a hunk: its localization is 0 by construction. Per-hunk ' +
      'judging produces a verdict per hunk under a stable (file, hunk-index) id, ' +
      'so a confirmed defect is localizable. On this synthetic fixture the local ' +
      `confirm judge is too noisy to give a clean accuracy number (it flagged ` +
      `benign hunks ${conservative.benignHunkFalse}/${count} and the planted mock ` +
      `${conservative.defectHunkFlagged}/${count}, a model failure on the isolated ` +
      'confirm question, not a localization-mechanism failure). The mechanism itself ' +
      'is pinned deterministically in `test/audit/cheat-detector/diff-chunker.test.ts` ' +
      '(stable per-hunk ids, one valid one-hunk diff per chunk). A stronger ' +
      'judge would lift the accuracy; the per-hunk infrastructure is in place.',
  );
  lines.push('');
  // The localized row is frozen evidence (sidecar); the conservative row is
  // the live/cached measurement above.
  lines.push('## v2: localized confirm prompt (measured 2026-06)');
  lines.push('');
  lines.push(
    'To test whether the conservative prompt was the cap, the per-hunk path was ' +
      'measured with the localized confirm prompt (local model `glm47-flash-abl`). ' +
      'The localized-prompt calls are not in the committed judge cache, so this ' +
      'row is read from the frozen sidecar ' +
      '`benchmarks/oracle-corpus/localized-experiment.json` and refreshed with ' +
      '`node dist/scripts/oracle/per-hunk.js --refresh-localized`.',
  );
  lines.push('');
  lines.push('| per-hunk confirm prompt | defect hunk flagged | points only at the defect hunk | benign hunk false-flagged |');
  lines.push('|---|---|---|---|');
  lines.push(
    `| conservative (v1) | ${conservative.defectHunkFlagged}/${count} | ${conservative.pointedCorrectly}/${count} | ${conservative.benignHunkFalse}/${count} |`,
  );
  lines.push(
    `| localized (experiment) | ${args.localizedDefectFlagged}/${count} | ${args.localizedPointedCorrectly}/${count} | ${args.localizedBenignFalse}/${count} |`,
  );
  lines.push('');
  lines.push(
    'The localized prompt did not move per-hunk localization. Unlike tail-defect ' +
      '(where the localized prompt lifted recall 0.1 to 0.5, see ' +
      '`tail-defect-recovery.md`), the per-hunk failure is not conservatism: the ' +
      'local model flags benign hunks and misses the planted mock regardless of ' +
      'prompt framing. This is a model-capability gap. Per-hunk localization stays ' +
      'infrastructure (the plumbing is proven by ' +
      '`test/audit/cheat-detector/diff-chunker.test.ts`); a stronger judge is the ' +
      'only path to a real localization number, not a prompt change.',
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const live = !argv.includes('--no-live');
  // --refresh-localized re-measures the localized per-hunk prompt against a
  // live model and rewrites the frozen sidecar. Without it, the localized
  // row is read from the committed sidecar (the calls are not cached).
  const refreshLocalized = argv.includes('--refresh-localized');
  const countArg = argv.indexOf('--count');
  const count = countArg !== -1 ? Number(argv[countArg + 1]) : 10;
  loadDotenv();
  const root = repoRoot();
  const cache = new JudgeCache(root);
  const judge = new BenchJudge(cache);

  let wholeFlagged = 0;
  for (let seed = 0; seed < count; seed += 1) {
    const c = buildCase(seed);
    const wholeUser = buildConfirmationPrompt('mock-of-hallucination', 'add tests', c.diff);
    const whole = await judge.ask(CONFIRM_SYSTEM_PROMPT, wholeUser, live);
    if (whole.answer === 'yes') wholeFlagged += 1;
  }
  const conservative = await measurePerHunk(judge, count, live, CONFIRM_SYSTEM_PROMPT);
  const experiment = readLocalizedExperiment(root);
  if (refreshLocalized) {
    const localized = await measurePerHunk(judge, count, live, LOCALIZED_CONFIRM_SYSTEM_PROMPT);
    if (localized.decisive === 0) {
      process.stderr.write(
        'per-hunk: --refresh-localized got no decisive localized answers ' +
          '(local model unreachable?); keeping the frozen sidecar.\n',
      );
    } else {
      experiment.perHunk = {
        count,
        localizedDefectFlagged: localized.defectHunkFlagged,
        localizedPointedCorrectly: localized.pointedCorrectly,
        localizedBenignFalse: localized.benignHunkFalse,
      };
      writeLocalizedExperiment(root, experiment);
      process.stdout.write(`per-hunk: refreshed localized sidecar (defect ${localized.defectHunkFlagged}/${count})\n`);
    }
  }
  cache.flush();

  const report = buildReport({
    count,
    wholeFlagged,
    conservative,
    localizedDefectFlagged: experiment.perHunk.localizedDefectFlagged,
    localizedPointedCorrectly: experiment.perHunk.localizedPointedCorrectly,
    localizedBenignFalse: experiment.perHunk.localizedBenignFalse,
  });
  fs.writeFileSync(path.join(root, 'benchmarks', 'oracle-corpus', 'per-hunk-localization.md'), report);
  process.stdout.write(
    `per-hunk: whole=${wholeFlagged}/${count} defect-localized=${conservative.defectHunkFlagged}/${count} ` +
      `clean-localized=${conservative.pointedCorrectly}/${count} benign-false=${conservative.benignHunkFalse}/${count} ` +
      `localized=frozen(${experiment.perHunk.localizedBenignFalse}/${experiment.perHunk.count} benign-false)\n`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`per-hunk: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}

export { main, buildReport };
