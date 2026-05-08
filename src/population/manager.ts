import * as crypto from 'crypto';
import type { FinalContract, ObligationV1 } from '../contract/types';
import type { JsonlLedger } from '../ledger/jsonl-ledger';
import { MemoStore, obligationKey } from '../ledger/memoization';
import type {
  CandidateDiscardedEntry,
  CandidateRecordedEntry,
  ObligationAttemptedEntry,
  ObligationFailedEntry,
  ObligationMemoizedEntry,
  ObligationSatisfiedEntry,
  RunFinishedEntry,
  RunStartedEntry,
  TournamentEscalatedEntry,
  TournamentRoundStartedEntry,
  TournamentWinnerSelectedEntry,
} from '../ledger/types';
import type { PersonaRegistry } from '../persona/persona-registry';
import type { PersonaSpec } from '../persona/types';
import { selectPersonaForState } from '../persona/predicates';
import type { Session, SessionUsage } from '../session/types';
import { addUsage, emptyUsage } from '../session/types';
import { verifyObligation } from '../verification/run-verifier';
import { applyFileEmit } from './diff-applier';
import { applyUnifiedDiff, looksLikeUnifiedDiff } from './unified-diff';
import { PopulationStateBuilder } from './state';
import {
  DEFAULT_TOURNAMENT_CONFIG,
  runTournament,
  type TournamentCandidate,
  type TournamentConfig,
  type TournamentLedgerSink,
  type TournamentPersonaSlate,
  type TournamentResult,
} from './tournament';

/** Mode the population manager runs in. */
export type PopulationMode = 'single' | 'tournament';

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
  /**
   * Execution mode: `single` runs the Phase 2 sequential path (one persona
   * per obligation, one candidate); `tournament` runs the Phase 3 path
   * (N candidates per obligation, scored by the tournament-verifier
   * persona, winner applied). Defaults to `single` for back-compat with
   * existing tests; the v8 CLI defaults to `tournament` post-Phase 3.
   */
  mode?: PopulationMode;
  /** Optional per-obligation-type tournament config override. */
  tournamentConfig?: Partial<Record<ObligationV1['type'], TournamentConfig>>;
  /**
   * Phase 4: obligation indexes to skip via memoization. Used by the
   * resume path: indexes already satisfied in a prior run are recorded
   * as `obligation-memoized` and the synthesis path is bypassed.
   */
  skipObligationIndexes?: ReadonlySet<number>;
  /**
   * Phase 4: optional memo store. The manager populates it during the
   * run and hands it to each tournament. Callers that want
   * cross-obligation in-run memoization pass an empty store; passing
   * null/undefined disables in-run memoization.
   */
  memoStore?: MemoStore;
}

/** Per-obligation outcome the manager hands back to the caller. */
export interface ObligationOutcome {
  obligationIndex: number;
  obligation: ObligationV1;
  personaId: string | null;
  satisfied: boolean;
  detail: string;
  /**
   * Tournament evidence when mode === 'tournament'. Null in single mode
   * or when the obligation never reached the tournament path.
   */
  tournament?: TournamentResult | null;
}

/** Aggregate result of running the contract. */
export interface RunPopulationResult {
  outcomes: ObligationOutcome[];
  satisfied: number;
  failed: number;
  totalUsage: SessionUsage;
  /** Wall time for the whole run, ms. */
  wallTimeMs: number;
  /** Mode the run executed under. */
  mode: PopulationMode;
  /** Phase 4: number of obligations satisfied via memoization (no synthesis). */
  memoizedObligations: number;
  /** Phase 4: total verifier calls saved via in-run candidate-hash dedup. */
  verifierCallsSavedByMemoization: number;
}

/**
 * Population manager. Walks unsatisfied obligations sequentially. For
 * each obligation, picks the persona via predicate evaluation and either:
 *   - `single` mode (Phase 2): one call, one candidate, apply, verify.
 *   - `tournament` mode (Phase 3): N candidates per round, verifier
 *     picks the winner, winner applied + verified; loser candidates are
 *     logged with full diff hash and token cost.
 *
 * Returns aggregate outcomes plus session usage and wall time.
 */
export async function runPopulation(
  options: RunPopulationOptions,
): Promise<RunPopulationResult> {
  const start = Date.now();
  const { contract, repoRoot, registry, session, ledger, commandTimeoutMs } = options;
  const cap = options.maxObligations ?? contract.obligations.length;
  const mode: PopulationMode = options.mode ?? 'single';
  const builder = new PopulationStateBuilder(contract.obligations);
  const skip = options.skipObligationIndexes ?? new Set<number>();
  const memoStore = options.memoStore;

  ledger.append<RunStartedEntry>({
    type: 'run-started',
    contractId: contract.manifest.contractId,
    contractHash: contract.manifest.contractHash,
    obligationCount: contract.obligations.length,
    goal: contract.manifest.goal,
  });

  // Phase 4: pre-mark skipped obligations as satisfied via memoization.
  // The audit trail records one `obligation-memoized` entry per skip.
  let memoizedObligations = 0;
  for (let i = 0; i < contract.obligations.length; i += 1) {
    if (!skip.has(i)) continue;
    const o = contract.obligations[i];
    if (!o) continue;
    builder.setStatus(i, 'satisfied');
    ledger.append<ObligationMemoizedEntry>({
      type: 'obligation-memoized',
      obligationIndex: i,
      obligationType: o.type,
      obligationKey: obligationKey(o),
      source: 'prior-run',
      responseSha256: null,
      detail: `obligation index ${i} satisfied by prior run; skipping synthesis`,
    });
    memoizedObligations += 1;
  }

  const outcomes: ObligationOutcome[] = [];
  let totalUsage = emptyUsage();
  let verifierCallsSavedByMemoization = 0;
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

    if (mode === 'tournament') {
      const result = await executeTournament({
        obligation,
        obligationIndex,
        primaryPersona: persona,
        registry,
        session,
        ledger,
        repoRoot,
        commandTimeoutMs,
        tournamentConfig: options.tournamentConfig,
        memoStore,
      });
      totalUsage = addUsage(totalUsage, result.tournament.usage);
      verifierCallsSavedByMemoization += result.tournament.verifierCallsSavedByMemoization;
      const winnerPersonaId = result.tournament.winner?.personaId ?? null;
      if (result.satisfied) {
        builder.setStatus(obligationIndex, 'satisfied');
        ledger.append<ObligationSatisfiedEntry>({
          type: 'obligation-satisfied',
          obligationIndex,
          obligationType: obligation.type,
          detail: result.detail,
        });
      } else {
        builder.setStatus(obligationIndex, 'failed');
        ledger.append<ObligationFailedEntry>({
          type: 'obligation-failed',
          obligationIndex,
          obligationType: obligation.type,
          detail: result.detail,
        });
      }
      outcomes.push({
        obligationIndex,
        obligation,
        personaId: winnerPersonaId,
        satisfied: result.satisfied,
        detail: result.detail,
        tournament: result.tournament,
      });
      continue;
    }

    // Single mode (Phase 2 path).
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
    } else if (looksLikeUnifiedDiff(response.text)) {
      try {
        applyUnifiedDiff(repoRoot, response.text);
      } catch {
        // The verifier will detect the failure; manager surfaces it.
      }
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
      tournament: null,
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
    mode,
    memoizedObligations,
    verifierCallsSavedByMemoization,
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

interface ExecuteTournamentArgs {
  obligation: ObligationV1;
  obligationIndex: number;
  primaryPersona: PersonaSpec;
  registry: PersonaRegistry;
  session: Session;
  ledger: JsonlLedger;
  repoRoot: string;
  commandTimeoutMs: number | undefined;
  tournamentConfig: RunPopulationOptions['tournamentConfig'];
  memoStore: MemoStore | undefined;
}

interface ExecuteTournamentResult {
  satisfied: boolean;
  detail: string;
  tournament: TournamentResult;
}

/**
 * Per-obligation tournament dispatcher used by the manager when
 * `mode === 'tournament'`. Builds the persona slate from the registry,
 * applies the per-type config, and turns ledger sink callbacks into
 * `JsonlLedger` writes.
 */
async function executeTournament(args: ExecuteTournamentArgs): Promise<ExecuteTournamentResult> {
  const {
    obligation,
    obligationIndex,
    primaryPersona,
    registry,
    session,
    ledger,
    repoRoot,
    commandTimeoutMs,
    tournamentConfig,
    memoStore,
  } = args;

  const config = {
    ...DEFAULT_TOURNAMENT_CONFIG[obligation.type],
    ...(tournamentConfig?.[obligation.type] ?? {}),
  };

  const fallback: PersonaSpec[] = registry
    .list()
    .filter((p) => p.id !== primaryPersona.id && p.handles.length === 0 ? false : p.id !== primaryPersona.id);
  const personas: TournamentPersonaSlate = { primary: [primaryPersona], fallback };

  const sink: TournamentLedgerSink = {
    recordRoundStarted(p) {
      ledger.append<TournamentRoundStartedEntry>({
        type: 'tournament-round-started',
        ...p,
      });
    },
    recordCandidate(p) {
      ledger.append<CandidateRecordedEntry>({
        type: 'candidate-recorded',
        ...p,
      });
    },
    recordWinner(p) {
      ledger.append<TournamentWinnerSelectedEntry>({
        type: 'tournament-winner-selected',
        ...p,
      });
    },
    recordDiscard(p) {
      ledger.append<CandidateDiscardedEntry>({
        type: 'candidate-discarded',
        ...p,
      });
    },
    recordEscalation(p) {
      ledger.append<TournamentEscalatedEntry>({
        type: 'tournament-escalated',
        ...p,
      });
    },
  };

  const tournamentOpts: Parameters<typeof runTournament>[0] = {
    obligation,
    obligationIndex,
    session,
    personas,
    config,
    renderUserMessage: (o) => renderDynamicMessage(o, repoRoot),
    applyCandidate: async (candidate: TournamentCandidate, ob: ObligationV1) => {
      const applyDetail = applyTournamentCandidate(repoRoot, ob, candidate.response.text);
      const verifyOpts: Parameters<typeof verifyObligation>[1] = { repoRoot };
      if (commandTimeoutMs !== undefined) verifyOpts.commandTimeoutMs = commandTimeoutMs;
      const verifyResult = verifyObligation(ob, verifyOpts);
      return {
        satisfied: verifyResult.satisfied,
        detail: `${applyDetail}; ${verifyResult.detail}`,
      };
    },
    ledgerSink: sink,
  };
  if (memoStore !== undefined) tournamentOpts.memoStore = memoStore;
  const result = await runTournament(tournamentOpts);

  if (result.satisfied) {
    return {
      satisfied: true,
      detail: result.detail,
      tournament: result,
    };
  }
  return {
    satisfied: false,
    detail: result.detail,
    tournament: result,
  };
}

/**
 * Apply a candidate's response to the workspace. Picks between the
 * fenced single-file applier (architect-style) and the unified-diff
 * applier (implementer/verifier-style) based on response shape and
 * obligation type. Returns a short detail string for the ledger.
 */
function applyTournamentCandidate(
  repoRoot: string,
  obligation: ObligationV1,
  responseText: string,
): string {
  const trimmed = responseText.trim();
  if (trimmed === 'no-op' || trimmed === '"no-op"') {
    return 'no-op declared';
  }
  if (obligation.type === 'file-must-exist') {
    const r = applyFileEmit(repoRoot, obligation.path, responseText);
    return r.detail;
  }
  if (looksLikeUnifiedDiff(responseText)) {
    try {
      const r = applyUnifiedDiff(repoRoot, responseText);
      return r.detail;
    } catch (err) {
      return `unified diff apply error: ${(err as Error).message.slice(0, 120)}`;
    }
  }
  return 'response was neither no-op nor a unified diff; nothing applied';
}
