// Phase 2: judge denoise pass. Runs gemma4:31b (via the Ollama provider,
// model id from SWARM_JUDGE_MODEL, never hardcoded) over every instance in the
// mined triage dataset, asking the v3-denoise prompt whether the diff contains
// a genuine cheat. The verdicts do two jobs: they denoise the weak revert
// anchor (a refuted revert-weak positive is a tangled/ghost false positive,
// demoted to unlabeled, the ReDef recipe), and they are the judge labeling
// function the Phase 3 label model reads.
//
// Calls go through the committed benchmark judge cache (key folds model id and
// the full prompt text), so the run replays byte-identical with --no-live and
// no model running.
//
// Usage:
//   SWARM_JUDGE_PROVIDER=ollama SWARM_JUDGE_MODEL=gemma4:31b \
//     node dist/scripts/triage/judge-denoise.js [--no-live] [--limit N]

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { applyDenoise, type InstanceVerdict, type JudgeVerdict } from '../../src/audit/triage/denoise';
import type { TriageDataset } from '../../src/audit/triage/types';
import { getJudgePromptSet } from '../../src/audit/cheat-detector/judge-prompts';
import { JudgeCache } from '../benchmarks/lib/judge-cache';
import { BenchJudge } from '../benchmarks/lib/judge-client';
import { repoRoot } from '../real-prs/lib/paths';

const log = getLogger('triage:denoise');

const PROMPT_VERSION = 'v3-denoise';
/** Tail-biased cap: oracle defects are appended at the diff tail, so when a
 *  diff is oversized we keep the tail (and a slice of the head for context).
 *  Kept small because a 31B model's prompt-eval time dominates the latency on
 *  large diffs; the cheat signal is local, so the tail window is enough. */
const MAX_DIFF_CHARS = 3_000;
/** Flush the committed cache every N live calls so a long run's progress is
 *  durable: an interrupted run re-runs as cache hits and continues. */
const FLUSH_EVERY = 20;

interface Args {
  allowLive: boolean;
  limit: number | null;
  offset: number;
}

function parseArgs(argv: string[]): Args {
  let allowLive = true;
  let limit: number | null = null;
  let offset = 0;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--no-live') allowLive = false;
    else if (argv[i] === '--limit' && argv[i + 1] !== undefined) {
      limit = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--offset' && argv[i + 1] !== undefined) {
      offset = Number(argv[i + 1]);
      i += 1;
    }
  }
  return { allowLive, limit, offset };
}

/** Keep the tail (where oracle injects) plus a head slice for context. */
function capDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) return diff;
  const headChars = Math.floor(MAX_DIFF_CHARS * 0.25);
  const tailChars = MAX_DIFF_CHARS - headChars;
  return `${diff.slice(0, headChars)}\n...[truncated]...\n${diff.slice(diff.length - tailChars)}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const datasetFile = path.join(root, 'benchmarks', 'triage', 'triage-dataset.json');
  const dataset = JSON.parse(fs.readFileSync(datasetFile, 'utf8')) as TriageDataset;

  const promptSet = getJudgePromptSet(PROMPT_VERSION);
  if (promptSet.denoiseSystem === undefined || promptSet.denoiseQuestion === undefined) {
    throw new Error(`prompt version ${PROMPT_VERSION} has no denoise path; register v3-denoise`);
  }
  const system = promptSet.denoiseSystem;

  const cache = new JudgeCache(root);
  const judge = new BenchJudge(cache);
  log.info(`judge provider ${judge.config().provider} model ${judge.config().model}`);

  // Single full pass over every instance. Only the selected slice
  // (--offset/--limit) is allowed to make live calls; outside it the ask is
  // cache-only (instant). So the written artifacts always reflect the full
  // dataset with whatever progress is in the committed cache, and a long run
  // can be done in slices, re-run idempotently, and resumed from the cache.
  const verdicts: InstanceVerdict[] = [];
  const counts: Record<JudgeVerdict, number> = { yes: 0, no: 0, unavailable: 0 };
  const sliceEnd = args.limit === null ? dataset.instances.length : args.offset + args.limit;

  for (let idx = 0; idx < dataset.instances.length; idx += 1) {
    const inst = dataset.instances[idx];
    const inSlice = idx >= args.offset && idx < sliceEnd;
    const diffAbs = path.join(root, inst.diffPath);
    if (!fs.existsSync(diffAbs)) {
      log.warn(`${inst.id}: diff missing at ${inst.diffPath}, recording unavailable`);
      verdicts.push({ id: inst.id, verdict: 'unavailable' });
      counts.unavailable += 1;
      continue;
    }
    const question = promptSet.denoiseQuestion(inst.category);
    const user = `${question}\n\n${capDiff(fs.readFileSync(diffAbs, 'utf8'))}`;
    const answer = await judge.ask(system, user, inSlice && args.allowLive);
    const verdict = answer.answer;
    counts[verdict] += 1;
    verdicts.push(
      answer.reason === undefined
        ? { id: inst.id, verdict }
        : { id: inst.id, verdict, reason: answer.reason },
    );
    if (judge.liveCallCount() > 0 && judge.liveCallCount() % FLUSH_EVERY === 0) {
      cache.flush();
      log.info(`live ${judge.liveCallCount()} (idx ${idx}/${dataset.instances.length}); cache flushed`);
    }
  }
  cache.flush();

  const outDir = path.join(root, 'benchmarks', 'triage');
  const verdictsOut = {
    promptVersion: PROMPT_VERSION,
    model: judge.config().model,
    counts,
    verdicts: [...verdicts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
  fs.writeFileSync(path.join(outDir, 'judge-verdicts.json'), JSON.stringify(verdictsOut, null, 2) + '\n');

  const denoised = applyDenoise(dataset, verdicts);
  fs.writeFileSync(
    path.join(outDir, 'denoised-dataset.json'),
    JSON.stringify(denoised.dataset, null, 2) + '\n',
  );

  log.info(
    `verdicts yes=${counts.yes} no=${counts.no} unavailable=${counts.unavailable}; ` +
      `denoise demoted=${denoised.summary.demoted} confirmed=${denoised.summary.confirmed} ` +
      `abstained=${denoised.summary.abstained}; live calls ${judge.liveCallCount()}`,
  );
  log.info(`denoised corpus sha256 ${denoised.dataset.corpusSha256}`);
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
