import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { finalize } from '../../src/contract/compiler';
import type { FinalContract, ObligationV1 } from '../../src/contract/types';
import { JsonlLedger } from '../../src/ledger/jsonl-ledger';
import { MemoStore } from '../../src/ledger/memoization';
import { createDefaultRegistry } from '../../src/persona/persona-registry';
import { runPopulation, type PopulationMode } from '../../src/population/manager';
import { StubSession } from '../../src/session/stub-session';
import type { SessionRequest, SessionUsage } from '../../src/session/types';
import {
  cacheHitRate,
  effectiveInputTokens,
} from '../../src/session/types';
import type { RepeatedPatternGoal } from './repeated-pattern-goals';

/**
 * Synthetic project-context preamble matching the Phase 2 bench harness
 * (~25K tokens of cached prefix). Lifted from `run-goal.ts` to keep the
 * cache amortization shape identical across phases.
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

export const REPEATED_PROJECT_CONTEXT =
  PROJECT_CONTEXT_PREAMBLE + PROJECT_CONTEXT_BODY + '\nEnd of project context.\n';

/** Aggregate result of a single repeated-pattern goal run, parameterized on memoization. */
export interface RepeatedGoalRunResult {
  goalId: string;
  obligationCount: number;
  satisfied: number;
  failed: number;
  memoizedObligations: number;
  verifierCallsSavedByMemoization: number;
  totalUsage: SessionUsage;
  effectiveInput: number;
  cacheHitRate: number;
  wallTimeMs: number;
}

export interface RunRepeatedGoalOptions {
  mode: PopulationMode;
  /** Phase 4 toggle: pass a fresh MemoStore to enable cross-obligation memoization. */
  memoization: boolean;
  /** Optional override for tournament candidates per round. */
  tournamentCandidates?: number;
  /** Optional cached prefix override (for tests). */
  projectContext?: string;
}

/**
 * Run a single repeated-pattern goal through the population manager. The
 * synthetic responder emits an identical architect body for every
 * file-must-exist obligation so the cross-obligation memoization layer
 * can demonstrate the savings.
 */
export async function runRepeatedGoal(
  goal: RepeatedPatternGoal,
  options: RunRepeatedGoalOptions,
): Promise<RepeatedGoalRunResult> {
  const projectContext = options.projectContext ?? REPEATED_PROJECT_CONTEXT;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-bench4-'));
  const contract = makeContract(work, goal.goal, goal.obligations);

  const session = new StubSession({
    projectContext,
    responder: (req: SessionRequest) => buildStubResponse(req),
  });
  const ledger = new JsonlLedger(path.join(work, 'ledger.jsonl'), goal.id);
  const runOptions: Parameters<typeof runPopulation>[0] = {
    contract,
    repoRoot: work,
    registry: createDefaultRegistry(),
    session,
    ledger,
    mode: options.mode,
  };
  if (options.memoization) {
    runOptions.memoStore = new MemoStore([]);
  }
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
  return {
    goalId: goal.id,
    obligationCount: goal.obligations.length,
    satisfied: result.satisfied,
    failed: result.failed,
    memoizedObligations: result.memoizedObligations,
    verifierCallsSavedByMemoization: result.verifierCallsSavedByMemoization,
    totalUsage: result.totalUsage,
    effectiveInput: effectiveInputTokens(result.totalUsage),
    cacheHitRate: cacheHitRate(result.totalUsage),
    wallTimeMs: result.wallTimeMs,
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
  if (req.personaId === 'tournament-verifier') {
    return JSON.stringify({ score: 0.85, rationale: 'synthetic-bench score' });
  }
  if (req.personaId === 'architect') {
    // Identical body for every architect dispatch — the natural shape
    // for "the same code in N services."
    return [
      '```',
      '// stub-emitted health-check file',
      'export function healthCheck() { return 200; }',
      '```',
    ].join('\n');
  }
  return 'no-op';
}
