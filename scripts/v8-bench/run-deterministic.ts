/**
 * Phase 5 deterministic-floor benchmark runner. Drives a single goal
 * through the population manager twice — once with the WASM runtime
 * disabled (baseline) and once with it enabled (deterministic) — and
 * captures comparable cost, satisfaction, and ledger-shape metrics.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { finalize } from '../../src/contract/compiler';
import { tagObligations } from '../../src/contract/tagger';
import type { FinalContract, ObligationV1 } from '../../src/contract/types';
import { JsonlLedger, readEntries } from '../../src/ledger/jsonl-ledger';
import { createDefaultRegistry } from '../../src/persona/persona-registry';
import { runPopulation, type PopulationMode } from '../../src/population/manager';
import { StubSession } from '../../src/session/stub-session';
import {
  cacheHitRate,
  effectiveInputTokens,
  type SessionRequest,
  type SessionUsage,
} from '../../src/session/types';
import { createDefaultRuntime, DEFAULT_STRATEGY_NAMES } from '../../src/wasm/registry';
import type { DeterministicGoal } from './deterministic-goals';

/** Cached project-context preamble matching prior phase benches. */
const PROJECT_CONTEXT = (
  'You are a persona inside the swarm-orchestrator v8 population.\n' +
  'Project context: a TypeScript monorepo with mocha tests and tsc builds.\n'
).repeat(800);

export interface DeterministicRunResult {
  goalId: string;
  obligationCount: number;
  satisfied: number;
  failed: number;
  deterministicObligations: number;
  deterministicReroutes: number;
  candidateRecordedCount: number;
  totalUsage: SessionUsage;
  effectiveInput: number;
  cacheHitRate: number;
  wallTimeMs: number;
}

export interface RunDeterministicGoalOptions {
  mode: PopulationMode;
  /** When true, attach the default WASM runtime; otherwise omit it. */
  deterministic: boolean;
  /** When true, also auto-tag the obligations before finalize. Default true. */
  autoTag?: boolean;
}

/**
 * Run a single deterministic-floor goal. Auto-tagging is on by default
 * so the §8 dispatch surface is exercised end-to-end.
 */
export async function runDeterministicGoal(
  goal: DeterministicGoal,
  options: RunDeterministicGoalOptions,
): Promise<DeterministicRunResult> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `v8-bench5-${goal.id}-`));
  const tagged = options.autoTag === false
    ? goal.obligations.slice()
    : tagObligations(goal.obligations, { availableStrategies: DEFAULT_STRATEGY_NAMES });
  const contract = makeContract(work, goal.goal, tagged);

  const session = new StubSession({
    projectContext: PROJECT_CONTEXT,
    responder: (req: SessionRequest) => buildStubResponse(req),
  });
  const ledgerPath = path.join(work, 'ledger.jsonl');
  const ledger = new JsonlLedger(ledgerPath, goal.id);
  const runOptions: Parameters<typeof runPopulation>[0] = {
    contract,
    repoRoot: work,
    registry: createDefaultRegistry(),
    session,
    ledger,
    mode: options.mode,
  };
  if (options.deterministic) {
    runOptions.wasmRuntime = createDefaultRuntime();
  }
  const result = await runPopulation(runOptions);

  const entries = readEntries(ledgerPath);
  const candidateRecordedCount = entries.filter((e) => e.type === 'candidate-recorded').length;

  return {
    goalId: goal.id,
    obligationCount: contract.obligations.length,
    satisfied: result.satisfied,
    failed: result.failed,
    deterministicObligations: result.deterministicObligations,
    deterministicReroutes: result.deterministicReroutes,
    candidateRecordedCount,
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
    return [
      '```',
      '// stub-emitted boilerplate file',
      'export const placeholder = true;',
      '```',
    ].join('\n');
  }
  return 'no-op';
}
