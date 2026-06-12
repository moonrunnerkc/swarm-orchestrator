import { strict as assert } from 'assert';
import {
  buildPrimaryPrompt,
  primarySystemPrompt,
} from '../../../src/audit/cheat-detector/llm-judge/anthropic-judge';
import { MAX_JUDGE_DIFF_CHARS } from '../../../src/audit/cheat-detector/llm-judge';
import {
  loadOracleCorpus,
  type OracleCase,
} from '../../../scripts/benchmarks/lib/corpora';
import {
  JudgeCache,
  judgeCacheKey,
} from '../../../scripts/benchmarks/lib/judge-cache';
import { withVerdictSuffix } from '../../../scripts/benchmarks/lib/judge-client';

// Deterministic precision/recall gate for the judge-primary path.
//
// Before this test, the existing judge-primary specs stubbed the
// JudgeClient and only exercised routing logic. The end-to-end
// `npm run calibrate:judge` was the only signal that recall or precision
// moved when PINNED_JUDGE_MODEL_ID or the v2-balanced prompts changed,
// and it sat outside the mocha gate — a prompt tweak could land without
// surfacing the regression.
//
// The suite gates on SWARM_JUDGE_INTEGRATION=1 the same way as the
// execution-grounded live tests. When the flag is unset (the default
// `npm test` path), the suite is skipped, so a contributor without a
// judge backend cannot be blocked. When the flag is set, the suite
// pulls a deterministic ~20-case semantic subset and asserts a recall
// floor against the committed bench cache. A cache miss surfaces as a
// hint that calibrate:judge needs to be rerun against the new prompts,
// which is the exact signal the reviewer asked for.

const INTEGRATION = process.env.SWARM_JUDGE_INTEGRATION === '1';
const VERSION = process.env.SWARM_JUDGE_VERSION ?? 'v1-conservative';
// The committed cache stores judgments under whatever model
// calibrate:judge replayed against. Today that is the free local
// rapid-mlx model so calibration runs do not bill the production API.
const MODEL = process.env.SWARM_JUDGE_MODEL ?? 'glm47-flash-abl';
// Calibration reports for the v1-conservative production default land at
// recall 0.50 on the held-out 20% subset; the floor sits 10pp below that
// (0.40) so a meaningful regression fires while normal sampling noise
// does not. Tighten alongside any prompt update that lifts the report.
const RECALL_FLOOR = 0.4;
const SUBSET_SIZE = 20;

function capDiff(diff: string): string {
  return diff.length <= MAX_JUDGE_DIFF_CHARS
    ? diff
    : diff.slice(0, MAX_JUDGE_DIFF_CHARS);
}

function deterministicSubset(cases: OracleCase[]): OracleCase[] {
  return cases.slice().sort((a, b) => a.prId.localeCompare(b.prId)).slice(0, SUBSET_SIZE);
}

(INTEGRATION ? describe : describe.skip)(
  'audit/cheat-detector/judge-primary-oracle (recall gate against committed cache)',
  function () {
    this.timeout(60_000);

    it('reaches the recall floor on the deterministic semantic subset', function () {
      const oracle = loadOracleCorpus();
      const semantic = oracle.filter(
        (c) =>
          c.category === 'goal-not-fixed' ||
          c.category === 'cheat-mock-mutation',
      );
      if (semantic.length === 0) {
        this.skip();
        return;
      }
      const subset = deterministicSubset(semantic);
      const cache = new JudgeCache();
      let positives = 0;
      let misses = 0;
      for (const c of subset) {
        const claim = c.label.claim ?? c.label.prTitle;
        const user = buildPrimaryPrompt(
          c.category as 'goal-not-fixed' | 'cheat-mock-mutation',
          claim,
          capDiff(c.brokenDiff),
          VERSION,
        );
        const system = primarySystemPrompt(VERSION);
        // The bench judge keys the cache after appending the verdict-format
        // suffix; the offline replay path must compute the same key.
        const key = judgeCacheKey(MODEL, system, withVerdictSuffix(user));
        const entry = cache.get(key);
        if (entry === undefined) {
          misses += 1;
          continue;
        }
        if (entry.answer === 'yes') positives += 1;
      }
      assert.equal(
        misses,
        0,
        `${misses}/${subset.length} cases missed the committed cache for ` +
          `version=${VERSION} model=${MODEL}; rerun calibrate:judge to ` +
          'refresh the cache against the current prompts',
      );
      const recall = positives / subset.length;
      assert.ok(
        recall >= RECALL_FLOOR,
        `recall ${recall.toFixed(2)} on the semantic subset is below floor ` +
          `${RECALL_FLOOR}; a prompt or model change has degraded judge ` +
          'sensitivity. Inspect benchmarks/oracle-corpus/judge-calibration.md ' +
          'and rerun calibrate:judge.',
      );
    });
  },
);
