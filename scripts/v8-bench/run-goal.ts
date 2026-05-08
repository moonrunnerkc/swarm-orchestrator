import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { finalize } from '../../src/contract/compiler';
import type { FinalContract, ObligationV1 } from '../../src/contract/types';
import { JsonlLedger } from '../../src/ledger/jsonl-ledger';
import { createDefaultRegistry } from '../../src/persona/persona-registry';
import { runPopulation, type PopulationMode } from '../../src/population/manager';
import { StubSession } from '../../src/session/stub-session';
import type { SessionRequest } from '../../src/session/types';
import {
  cacheHitRate,
  effectiveInputTokens,
  type SessionUsage,
} from '../../src/session/types';
import { modelV6Usage, type V6Model, DEFAULT_V6_MODEL } from './v6-model';
import type { BenchGoal } from './goals';

/**
 * Representative project-context snapshot. Sized to mirror what v8
 * actually caches in production: a codebase summary plus recent ledger
 * highlights, ~100K characters ⇒ ~25K tokens at the 4-chars-per-token
 * estimator. The v6 model in §6 also assumes ~40K tokens of bootstrap
 * input per CLI invocation; sizing v8's cached prefix in the same range
 * keeps the comparison honest — both substrates are paying for "the
 * project," just at different cache rates.
 *
 * The exact text is filler; the size is what matters for the synthetic
 * benchmark. Real-API runs would replace this with the live project
 * summary the contract compiler discovers.
 */
const PROJECT_CONTEXT_PREAMBLE = [
  'You are a persona inside the swarm-orchestrator v8 population.',
  'Project: TypeScript monorepo. Build: tsc. Tests: mocha.',
  'Conventions: kebab-case files, named exports, 300-line ceiling, full JSDoc.',
  '',
  'Repository overview (synthetic, sized to ~25K tokens to match',
  'production cached-prefix scale):',
  '',
].join('\n');

const PROJECT_CONTEXT_BODY = (
  'package.json declares scripts build, test, lint, format.\n' +
  'src/contract owns goal-to-contract compilation and serialization.\n' +
  'src/persona owns persona registry and trigger predicates.\n' +
  'src/session owns the prompt-cache-native inference session.\n' +
  'src/population owns sequential and tournament-mode obligation execution.\n' +
  'src/ledger owns append-only JSONL evidence with hash-chain in Phase 4.\n' +
  'src/wasm hosts deterministic transformations under WASM sandboxing.\n' +
  'src/verification hosts pre/mid/post-generation verifiers and the run-time gate.\n'
).repeat(800);

export const BENCH_PROJECT_CONTEXT = PROJECT_CONTEXT_PREAMBLE + PROJECT_CONTEXT_BODY + '\nEnd of project context.\n';

export interface GoalRunResult {
  goalId: string;
  size: BenchGoal['size'];
  obligationCount: number;
  satisfied: number;
  failed: number;
  v8Usage: SessionUsage;
  v8EffectiveInput: number;
  v8WallTimeMs: number;
  v8CacheHitRate: number;
  v6Usage: SessionUsage;
  v6EffectiveInput: number;
  /** v8 effective input / v6 effective input. <1 means v8 is cheaper. */
  inputRatio: number;
  /** 1 - inputRatio. */
  inputReductionPct: number;
}

export interface RunGoalOptions {
  v6Model?: V6Model;
  /** Project context the v8 session caches. Defaults to BENCH_PROJECT_CONTEXT. */
  projectContext?: string;
  /**
   * Test seam for sanity-checking the runner against golden numbers; not used
   * by the production benchmark harness.
   */
  workRoot?: string;
  /** Population mode: 'single' (Phase 2) or 'tournament' (Phase 3). */
  mode?: PopulationMode;
  /**
   * Tournament candidates per round when mode === 'tournament'. Defaults to
   * the per-type defaults in DEFAULT_TOURNAMENT_CONFIG.
   */
  tournamentCandidates?: number;
}

/**
 * Run a single benchmark goal. v8 path actually executes the population
 * manager against a fresh fixture using a stub session; v6 path is the
 * synthetic model from `v6-model.ts`. Both pass-rate measurements are real
 * for v8 (the manager records them); v6's pass rate is implied to be 1.0
 * because the synthetic model has no failure mode that we can attribute on
 * a per-obligation basis.
 */
export async function runBenchGoal(
  goal: BenchGoal,
  options: RunGoalOptions = {},
): Promise<GoalRunResult> {
  const v6Model = options.v6Model ?? DEFAULT_V6_MODEL;
  const projectContext = options.projectContext ?? BENCH_PROJECT_CONTEXT;
  const work = options.workRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'v8-bench-'));
  fs.mkdirSync(work, { recursive: true });
  const mode: PopulationMode = options.mode ?? 'single';

  const contract = makeContract(work, goal.goal, goal.obligations);

  const session = new StubSession({
    projectContext,
    responder: (req) => buildStubResponse(req),
  });
  const ledger = new JsonlLedger(path.join(work, 'ledger.jsonl'), goal.id);
  const runOptions: Parameters<typeof runPopulation>[0] = {
    contract,
    repoRoot: work,
    registry: createDefaultRegistry(),
    session,
    ledger,
    mode,
  };
  if (mode === 'tournament' && options.tournamentCandidates !== undefined) {
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

function makeContract(repoRoot: string, goal: string, obligations: ObligationV1[]): FinalContract {
  return finalize({
    schemaVersion: 'v1',
    goal,
    repoContext: { repoRoot, buildCommand: 'true', testCommand: 'true', language: 'typescript' },
    obligations,
    extractor: { name: 'bench-stub', model: null, temperature: null, promptSha256: null },
  });
}

function buildStubResponse(req: SessionRequest): string {
  // Tournament-verifier persona expects a strict JSON envelope with a
  // score above the threshold so the synthetic benchmark commits the
  // first candidate deterministically (see Phase 3 verifier-persona.ts).
  if (req.personaId === 'tournament-verifier') {
    return JSON.stringify({ score: 0.85, rationale: 'synthetic-bench score' });
  }
  if (req.personaId === 'architect') {
    return [
      '```',
      `// stub-emitted file for benchmark goal`,
      `// architect persona is the only synthesis path in Phase 2`,
      'export const placeholder = true;',
      '```',
    ].join('\n');
  }
  return 'no-op';
}
