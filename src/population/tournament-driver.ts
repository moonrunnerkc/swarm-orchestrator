// Scheduler↔tournament glue: lifts the runTournament call out of
// manager.ts so the manager focuses on the per-obligation scheduling
// loop while this file owns the ledger-sink wiring and the
// applyCandidate callback that funnels each round-winner back into the
// shared `attemptApplyAndVerify` seam.

import type { ObligationV1 } from '../contract/types';
import type { JsonlLedger } from '../ledger/jsonl-ledger';
import type { MemoStore } from '../ledger/memoization';
import type {
  CandidateDiscardedEntry,
  CandidateRecordedEntry,
  CandidateStreamAbortedEntry,
  TournamentEscalatedEntry,
  TournamentRoundStartedEntry,
  TournamentWinnerSelectedEntry,
} from '../ledger/types';
import type { PersonaRegistry } from '../persona/persona-registry';
import type { PersonaSpec } from '../persona/types';
import type { Session } from '../session/types';
import type { LiveCostTracker } from '../verification/live-cost-tracker';
import type { StreamingAssertion } from '../verification/streaming-verifier';
import { providerAttribution, attemptApplyAndVerify } from './manager';
import type { RunPopulationOptions } from './manager';
import { renderDynamicMessage, type RenderContext } from './persona-message';
import {
  DEFAULT_TOURNAMENT_CONFIG,
  runTournament,
  type TournamentCandidate,
  type TournamentLedgerSink,
  type TournamentPersonaSlate,
  type TournamentResult,
} from './tournament';

export interface ExecuteTournamentArgs {
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
  renderContext: RenderContext;
  fileMustExistPaths: ReadonlySet<string>;
  runId: string;
  streamingAssertions?: readonly StreamingAssertion[];
  costTracker?: LiveCostTracker;
}

export interface ExecuteTournamentResult {
  satisfied: boolean;
  detail: string;
  tournament: TournamentResult;
}

export async function executeTournament(
  args: ExecuteTournamentArgs,
): Promise<ExecuteTournamentResult> {
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
    renderContext,
    fileMustExistPaths,
    runId,
  } = args;

  const config = {
    ...DEFAULT_TOURNAMENT_CONFIG[obligation.type],
    ...(tournamentConfig?.[obligation.type] ?? {}),
  };

  const fallback: PersonaSpec[] = registry
    .list()
    .filter((p) => (p.id !== primaryPersona.id && p.handles.length === 0 ? false : p.id !== primaryPersona.id));
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
        ...providerAttribution(session),
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
        ...providerAttribution(session),
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
    renderUserMessage: (o) => renderDynamicMessage(o, repoRoot, renderContext),
    applyCandidate: async (candidate: TournamentCandidate, ob: ObligationV1) => {
      const r = await attemptApplyAndVerify({
        obligation: ob,
        obligationIndex,
        responseText: candidate.response.text,
        repoRoot,
        ledger,
        runId,
        fileMustExistPaths,
        commandTimeoutMs,
        renderContext,
        trigger: 'per-obligation-falsification',
      });
      return {
        satisfied: r.satisfied,
        detail: `${r.applyDetail}; ${r.verifyDetail}`,
      };
    },
    ledgerSink: sink,
    streamingSink: {
      recordStreamAborted(p) {
        ledger.append<CandidateStreamAbortedEntry>({
          type: 'candidate-stream-aborted',
          ...p,
        });
      },
    },
  };
  if (memoStore !== undefined) tournamentOpts.memoStore = memoStore;
  if (args.streamingAssertions !== undefined) tournamentOpts.streamingAssertions = args.streamingAssertions;
  if (args.costTracker !== undefined) tournamentOpts.costTracker = args.costTracker;
  const result = await runTournament(tournamentOpts);

  return {
    satisfied: result.satisfied,
    detail: result.detail,
    tournament: result,
  };
}

