/**
 * Phase 6 streaming-verification benchmark runner. Drives a single
 * streaming goal through the population manager twice — once with
 * streaming disabled (baseline; full response generated and billed)
 * and once with streaming enabled (doomed responses abort mid-stream
 * via the configured forbidden-imports assertion).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { finalize } from '../../src/contract/compiler';
import type { FinalContract, ObligationV1 } from '../../src/contract/types';
import { JsonlLedger, readEntries } from '../../src/ledger/jsonl-ledger';
import { createDefaultRegistry } from '../../src/persona/persona-registry';
import { runPopulation } from '../../src/population/manager';
import { StubSession } from '../../src/session/stub-session';
import {
  cacheHitRate,
  effectiveInputTokens,
  type SessionRequest,
  type SessionUsage,
} from '../../src/session/types';
import type { StreamingGoal } from './streaming-goals';

const PROJECT_CONTEXT = (
  'You are a persona inside the swarm-orchestrator v8 population.\n' +
  'Project context: a TypeScript monorepo with mocha tests and tsc builds.\n'
).repeat(800);

export interface StreamingRunResult {
  goalId: string;
  obligationCount: number;
  satisfied: number;
  failed: number;
  streamingAbortedCandidates: number;
  streamingCharsBeforeAbort: number;
  preVerifiedObligations: number;
  candidateRecordedCount: number;
  candidateStreamAbortedCount: number;
  totalUsage: SessionUsage;
  effectiveInput: number;
  cacheHitRate: number;
  wallTimeMs: number;
}

export interface RunStreamingGoalOptions {
  /** When true, route generation through the streaming verifier. */
  streaming: boolean;
}

/**
 * Run a single streaming-verifier goal. Builds an architect response
 * sized to `goal.responseLength`; the doomed variant prepends a
 * forbidden import line so the streaming verifier aborts early.
 */
export async function runStreamingGoal(
  goal: StreamingGoal,
  options: RunStreamingGoalOptions,
): Promise<StreamingRunResult> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `v8-bench6-${goal.id}-`));
  const contract = makeContract(work, goal.goal, goal.obligations);

  const architectBody = makeArchitectBody(goal);
  const session = new StubSession({
    projectContext: PROJECT_CONTEXT,
    responder: (req: SessionRequest) => buildStubResponse(req, architectBody),
    streamChunkSize: 8,
  });
  const ledgerPath = path.join(work, 'ledger.jsonl');
  const ledger = new JsonlLedger(ledgerPath, goal.id);
  const runOptions: Parameters<typeof runPopulation>[0] = {
    contract,
    repoRoot: work,
    registry: createDefaultRegistry(),
    session,
    ledger,
    mode: 'single',
    // Phase 6 floor only — leave Phase 4/5 features off so the
    // benchmark cleanly attributes savings to streaming.
    preGeneration: false,
    postMerge: false,
  };
  if (options.streaming) {
    runOptions.streaming = { forbiddenImports: goal.forbiddenImports };
  }
  const result = await runPopulation(runOptions);

  const entries = readEntries(ledgerPath);
  const candidateRecordedCount = entries.filter((e) => e.type === 'candidate-recorded').length;
  const candidateStreamAbortedCount = entries.filter(
    (e) => e.type === 'candidate-stream-aborted',
  ).length;

  return {
    goalId: goal.id,
    obligationCount: contract.obligations.length,
    satisfied: result.satisfied,
    failed: result.failed,
    streamingAbortedCandidates: result.streamingAbortedCandidates,
    streamingCharsBeforeAbort: result.streamingCharsBeforeAbort,
    preVerifiedObligations: result.preVerifiedObligations,
    candidateRecordedCount,
    candidateStreamAbortedCount,
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

/**
 * Architect persona response body. The doomed variant places the
 * forbidden import in the first line so the streaming verifier aborts
 * after a small number of chunks; the clean variant generates a body
 * of the same total length without the forbidden line.
 */
function makeArchitectBody(goal: StreamingGoal): string {
  const filler = Array.from({ length: Math.max(1, Math.floor(goal.responseLength / 32)) })
    .map((_, i) => `export const v${i} = ${i};`)
    .join('\n');
  if (goal.doomed) {
    return `import doomed from '${goal.forbiddenImports[0] ?? 'doomed-pkg'}'\n${filler}`;
  }
  return filler;
}

function buildStubResponse(req: SessionRequest, architectBody: string): string {
  if (req.personaId === 'architect') return architectBody;
  return 'no-op';
}
