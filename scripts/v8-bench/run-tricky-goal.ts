/**
 * Phase 3 tricky-goal runner. Drives the population manager against a
 * deliberately failure-prone synthetic candidate distribution so the
 * tournament's diversity injection actually has work to do. Used by the
 * Phase 3 §6 ship-gate (`tournament-vs-single` cost/accuracy comparison).
 *
 * In single mode every obligation is satisfied by a single candidate;
 * with `expectedFailureRate=p` the candidate is bad with probability p
 * and the obligation fails verification.
 *
 * In tournament mode N candidates per round are drawn; with the same
 * `expectedFailureRate=p` the round fails iff *every* candidate is bad,
 * which is `p^N`. The score the synthetic verifier returns is rendered
 * as a simple Bernoulli (good=0.9, bad=0.1) so the threshold-driven
 * tournament logic naturally rejects bad candidates.
 *
 * Determinism: the runner takes a numeric seed and uses a small linear
 * congruential PRNG so repeat runs reproduce the same outcomes. This
 * keeps the §6 benchmark reproducible.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { finalize } from '../../src/contract/compiler';
import type { FinalContract } from '../../src/contract/types';
import { JsonlLedger } from '../../src/ledger/jsonl-ledger';
import { createDefaultRegistry } from '../../src/persona/persona-registry';
import { runPopulation, type PopulationMode } from '../../src/population/manager';
import { StubSession } from '../../src/session/stub-session';
import {
  cacheHitRate,
  effectiveInputTokens,
  type SessionRequest,
} from '../../src/session/types';
import { modelV6Usage, type V6Model, DEFAULT_V6_MODEL } from './v6-model';
import { BENCH_PROJECT_CONTEXT, type GoalRunResult } from './run-goal';
import type { TrickyGoal } from './tricky-goals';

export interface RunTrickyGoalOptions {
  mode: PopulationMode;
  /** Tournament candidates per round; ignored in single mode. */
  tournamentCandidates?: number;
  /** PRNG seed; defaults to a hash of the goal id for reproducibility. */
  seed?: number;
  v6Model?: V6Model;
  projectContext?: string;
  workRoot?: string;
}

/**
 * Counter-based PRNG: each call combines the seed with a monotonic
 * counter through MurmurHash3-style mixing. This avoids the LCG
 * weak-correlation pathologies that gave certain (seed, count) pairs
 * deterministically biased sequences during Phase 3 bench tuning.
 */
function makePrng(seed: number): () => number {
  let counter = 0;
  return () => {
    counter += 1;
    let h = seed ^ counter;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 0x1_0000_0000;
  };
}

/** Stable hash of a string to seed the PRNG when no explicit seed is given. */
function hashString(s: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

function makeContract(repoRoot: string, goal: TrickyGoal): FinalContract {
  return finalize({
    schemaVersion: 'v1',
    goal: goal.goal,
    repoContext: {
      repoRoot,
      buildCommand: 'true',
      testCommand: 'true',
      language: 'typescript',
    },
    obligations: goal.obligations,
    extractor: { name: 'tricky-bench', model: null, temperature: null, promptSha256: null },
  });
}

/**
 * Run a single tricky goal. The synthetic responder uses the supplied
 * PRNG to decide each candidate's "quality": bad candidates get a low
 * score from the verifier (0.1), good candidates get a high score (0.9).
 * The tournament threshold (0.5) naturally rejects bad candidates.
 */
export async function runTrickyGoal(
  goal: TrickyGoal,
  options: RunTrickyGoalOptions,
): Promise<GoalRunResult> {
  const v6Model = options.v6Model ?? DEFAULT_V6_MODEL;
  const projectContext = options.projectContext ?? BENCH_PROJECT_CONTEXT;
  const work = options.workRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'v8-tricky-'));
  fs.mkdirSync(work, { recursive: true });
  const seed = options.seed ?? hashString(`${goal.id}|${options.mode}`);
  const rng = makePrng(seed);

  // Track per-candidate quality so the verifier scores it consistently
  // when the same candidate text reappears across rounds.
  const qualityByText = new Map<string, 'good' | 'bad'>();

  // Route the responder by *obligation type* rather than persona id so
  // the bench is invariant to the size of the registry. Phase 7 (impl
  // guide §10) expands the default registry to eight personas; rounds
  // beyond round 0 draw from the broader fallback pool, and the older
  // persona-id-keyed responder would accidentally route Phase 7 personas
  // through the catch-all 'no-op' branch — coupling the rng-advance
  // count to the registry size and changing tournament outcomes for
  // reasons unrelated to the bench's stated invariant. Routing by
  // obligation type eliminates that coupling: every synthesis persona
  // produces a marker-bearing candidate for file obligations, and every
  // synthesis persona produces 'no-op' for build/test obligations,
  // regardless of which slot in the fallback pool they occupy.
  const responder = (req: SessionRequest): string => {
    if (req.personaId === 'tournament-verifier') {
      const m = req.userMessage.match(/<<<CANDIDATE\n([\s\S]*?)\nCANDIDATE>>>/);
      const candidate = m?.[1] ?? '';
      const tag = qualityByText.get(candidate) ?? 'good';
      const score = tag === 'good' ? 0.9 : 0.1;
      return JSON.stringify({ score, rationale: `tricky-${tag}` });
    }
    // Detect obligation type by inspecting the rendered user message.
    // `renderDynamicMessage` embeds `JSON.stringify(obligation)` on the
    // second line, which contains the type tag.
    const isFileObligation = req.userMessage.includes('"type":"file-must-exist"');
    if (isFileObligation) {
      const isBad = rng() < goal.expectedFailureRate;
      const tag = isBad ? 'bad' : 'good';
      // The "good" candidate emits the marker the build-must-pass
      // command grep's for; the "bad" candidate omits it. The build
      // verification will then pass for good and fail for bad.
      const markerLine = isBad
        ? '// no marker present'
        : `// ${goal.marker}`;
      const candidate =
        '```\n' +
        `// tricky bench candidate (${tag})\n` +
        `// goal: ${goal.id}\n` +
        `// nonce: ${rng().toString(36)}\n` +
        `${markerLine}\n` +
        'export const placeholder = true;\n' +
        '```';
      qualityByText.set(candidate, tag);
      return candidate;
    }
    // Build/test obligations: every persona emits 'no-op'. The build
    // verification grep's the architect-emitted file body, so what
    // matters is whether the file-must-exist tournament committed a
    // good candidate.
    return 'no-op';
  };

  const session = new StubSession({ projectContext, responder });
  const ledger = new JsonlLedger(path.join(work, 'ledger.jsonl'), `${goal.id}-${options.mode}`);
  const contract = makeContract(work, goal);

  const runOptions: Parameters<typeof runPopulation>[0] = {
    contract,
    repoRoot: work,
    registry: createDefaultRegistry(),
    session,
    ledger,
    mode: options.mode,
  };
  if (options.mode === 'tournament' && options.tournamentCandidates !== undefined) {
    const n = options.tournamentCandidates;
    runOptions.tournamentConfig = {
      'file-must-exist': {
        candidatesPerRound: n,
        roundCap: 3,
        scoreThreshold: 0.5,
        temperatureSchedule: [0.2, 0.5, 0.8],
      },
      'build-must-pass': {
        candidatesPerRound: n,
        roundCap: 3,
        scoreThreshold: 0.5,
        temperatureSchedule: [0.1, 0.4, 0.7],
      },
      'test-must-pass': {
        candidatesPerRound: n,
        roundCap: 3,
        scoreThreshold: 0.5,
        temperatureSchedule: [0.1, 0.4, 0.7],
      },
    };
  }
  const result = await runPopulation(runOptions);

  const v8Eff = effectiveInputTokens(result.totalUsage);
  const v6Usage = modelV6Usage(goal.obligations, v6Model);
  const v6Eff = effectiveInputTokens(v6Usage);
  const ratio = v6Eff === 0 ? 0 : v8Eff / v6Eff;

  return {
    goalId: goal.id,
    size: goal.size,
    obligationCount: goal.obligations.length,
    satisfied: result.satisfied,
    failed: result.failed,
    v8Usage: result.totalUsage,
    v8EffectiveInput: v8Eff,
    v8WallTimeMs: result.wallTimeMs,
    v8CacheHitRate: cacheHitRate(result.totalUsage),
    v6Usage,
    v6EffectiveInput: v6Eff,
    inputRatio: ratio,
    inputReductionPct: 1 - ratio,
  };
}
