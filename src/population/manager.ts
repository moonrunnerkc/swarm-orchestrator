import * as crypto from 'crypto';
import type { FinalContract, ObligationV1 } from '../contract/types';
import type { JsonlLedger } from '../ledger/jsonl-ledger';
import type {
  CandidateRecordedEntry,
  ObligationAttemptedEntry,
  ObligationFailedEntry,
  ObligationSatisfiedEntry,
  RunFinishedEntry,
  RunStartedEntry,
} from '../ledger/types';
import type { PersonaRegistry } from '../persona/persona-registry';
import type { PersonaSpec } from '../persona/types';
import { selectPersonaForState } from '../persona/predicates';
import type { Session, SessionUsage } from '../session/types';
import { addUsage, emptyUsage } from '../session/types';
import { verifyObligation } from '../verification/run-verifier';
import { applyFileEmit } from './diff-applier';
import { PopulationStateBuilder } from './state';

export interface RunPopulationOptions {
  contract: FinalContract;
  /** Repo root the verifier and applier resolve paths against. */
  repoRoot: string;
  /** Persona registry the manager dispatches against. */
  registry: PersonaRegistry;
  /** Session used for every persona call. */
  session: Session;
  /** Ledger used to record evidence of every action. */
  ledger: JsonlLedger;
  /** Cap on commands run by the verifier. */
  commandTimeoutMs?: number;
  /** Optional cap on obligations attempted; useful for tests. */
  maxObligations?: number;
}

/** Per-obligation outcome the manager hands back to the caller. */
export interface ObligationOutcome {
  obligationIndex: number;
  obligation: ObligationV1;
  personaId: string | null;
  satisfied: boolean;
  detail: string;
}

/** Aggregate result of running the contract. */
export interface RunPopulationResult {
  outcomes: ObligationOutcome[];
  satisfied: number;
  failed: number;
  totalUsage: SessionUsage;
  /** Wall time for the whole run, ms. */
  wallTimeMs: number;
}

/**
 * Phase 2 population manager. Walks unsatisfied obligations sequentially,
 * one persona at a time. For each obligation:
 *   1. Pick the persona via predicate evaluation.
 *   2. Build a per-call user message containing the obligation.
 *   3. Call the session.
 *   4. Apply the response (file-must-exist only in Phase 2).
 *   5. Run the verifier.
 *   6. Append a ledger entry.
 *
 * Build/test obligations don't have an apply step yet — Phase 2 simply
 * runs the command via the verifier to record the current pass/fail state.
 * Phase 3 introduces the tournament path that produces patches for those.
 *
 * Returns aggregate outcomes plus session usage and wall time.
 */
export async function runPopulation(
  options: RunPopulationOptions,
): Promise<RunPopulationResult> {
  const start = Date.now();
  const { contract, repoRoot, registry, session, ledger, commandTimeoutMs } = options;
  const cap = options.maxObligations ?? contract.obligations.length;
  const builder = new PopulationStateBuilder(contract.obligations);

  ledger.append<RunStartedEntry>({
    type: 'run-started',
    contractId: contract.manifest.contractId,
    contractHash: contract.manifest.contractHash,
    obligationCount: contract.obligations.length,
    goal: contract.manifest.goal,
  });

  const outcomes: ObligationOutcome[] = [];
  let totalUsage = emptyUsage();
  let attempted = 0;

  while (attempted < cap) {
    const selection = selectPersonaForState(registry, builder.view());
    if (!selection) break;
    attempted += 1;
    const { persona, obligationIndex } = selection;
    const obligation = contract.obligations[obligationIndex];
    if (!obligation) break;
    builder.setStatus(obligationIndex, 'in-progress');

    ledger.append<ObligationAttemptedEntry>({
      type: 'obligation-attempted',
      obligationIndex,
      obligationType: obligation.type,
      personaId: persona.id,
    });

    const dynamic = renderDynamicMessage(obligation, repoRoot);
    const response = await session.complete({
      personaId: persona.id,
      personaSystemSuffix: persona.systemSuffix,
      sampling: { ...persona.sampling },
      userMessage: dynamic,
    });
    totalUsage = addUsage(totalUsage, response.usage);

    ledger.append<CandidateRecordedEntry>({
      type: 'candidate-recorded',
      obligationIndex,
      personaId: persona.id,
      responseSha256: sha256(response.text),
      usage: response.usage,
      model: response.model,
    });

    if (obligation.type === 'file-must-exist') {
      applyFileEmit(repoRoot, obligation.path, response.text);
    }

    const verifyOpts: Parameters<typeof verifyObligation>[1] = { repoRoot };
    if (commandTimeoutMs !== undefined) verifyOpts.commandTimeoutMs = commandTimeoutMs;
    const verifyResult = verifyObligation(obligation, verifyOpts);

    if (verifyResult.satisfied) {
      builder.setStatus(obligationIndex, 'satisfied');
      ledger.append<ObligationSatisfiedEntry>({
        type: 'obligation-satisfied',
        obligationIndex,
        obligationType: obligation.type,
        detail: verifyResult.detail,
      });
    } else {
      builder.setStatus(obligationIndex, 'failed');
      ledger.append<ObligationFailedEntry>({
        type: 'obligation-failed',
        obligationIndex,
        obligationType: obligation.type,
        detail: verifyResult.detail,
      });
    }

    outcomes.push({
      obligationIndex,
      obligation,
      personaId: persona.id,
      satisfied: verifyResult.satisfied,
      detail: verifyResult.detail,
    });
  }

  const satisfied = builder.countInStatus('satisfied');
  const failed = builder.countInStatus('failed');

  ledger.append<RunFinishedEntry>({
    type: 'run-finished',
    satisfied,
    failed,
    totalUsage,
  });

  return {
    outcomes,
    satisfied,
    failed,
    totalUsage,
    wallTimeMs: Date.now() - start,
  };
}

/**
 * Build the per-call user message for an obligation. The contract context
 * (goal, repo summary) is sent once via the cached system block; only the
 * per-obligation specifics go here so cache hits dominate.
 */
export function renderDynamicMessage(obligation: ObligationV1, repoRoot: string): string {
  const lines = [
    `Obligation:`,
    JSON.stringify(obligation),
    '',
    `Repository root: ${repoRoot}`,
    '',
  ];
  if (obligation.type === 'file-must-exist') {
    lines.push(`Emit the file content for ${obligation.path}.`);
    lines.push(
      'Wrap the file body in a single fenced code block. No prose outside the fences.',
    );
  } else if (obligation.type === 'build-must-pass') {
    lines.push(`The repository must satisfy: ${obligation.command}`);
    lines.push('If the build is already passing, output the literal text "no-op".');
    lines.push(
      'Otherwise output a unified diff against repo root that makes the build pass.',
    );
  } else {
    lines.push(`The repository must satisfy: ${obligation.command}`);
    lines.push('If tests already pass, output the literal text "no-op".');
    lines.push('Otherwise output a unified diff against repo root that makes tests pass.');
  }
  return lines.join('\n');
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Persona helper used by tests: list the personas a given registry exposes. */
export function listPersonaIds(registry: PersonaRegistry): string[] {
  return registry.list().map((p: PersonaSpec) => p.id);
}
