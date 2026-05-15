// Speculative-synthesis tournament harness. Per impl guide §6:
// diversity injection across rounds, hard cap of three rounds before
// escalating. The harness is agnostic to *what* personas produce —
// applyCandidate knows how to translate the winner into on-disk
// changes.

import * as crypto from 'crypto';
import type { ObligationV1 } from '../contract/types';
import type { MemoStore } from '../ledger/memoization';
import type { Session, SessionResponse, SessionUsage } from '../session/types';
import { addUsage, emptyUsage } from '../session/types';
import type { PersonaSpec } from './../persona/types';
import {
  TOURNAMENT_VERIFIER_PERSONA,
  scoreCandidate,
  type ScoredCandidate,
} from './../persona/verifier-persona';
import {
  runStreamingCompletion,
  type StreamingAssertion,
  type StreamingVerifierOutcome,
} from '../verification/streaming-verifier';
import type { LiveCostTracker } from '../verification/live-cost-tracker';

// Defaults match impl guide §6: 2–4 candidates, 3-round cap with
// diversity injection.
export interface TournamentConfig {
  candidatesPerRound: number;
  roundCap: number;
  // Below threshold, the round is a wash and diversity injection takes
  // over (or escalation if the cap is hit).
  scoreThreshold: number;
  // Round k uses index `k mod length`. Temperatures should differ
  // across rounds for diversity.
  temperatureSchedule: number[];
  verifierPersona?: PersonaSpec;
  verifierModel?: string;
}

// File-must-exist uses a smaller pool (architects converge);
// build/test get the wider pool because the decisions are subtler.
export const DEFAULT_TOURNAMENT_CONFIG: Record<ObligationV1['type'], TournamentConfig> = {
  'file-must-exist': {
    candidatesPerRound: 2,
    roundCap: 3,
    scoreThreshold: 0.5,
    temperatureSchedule: [0.2, 0.5, 0.8],
  },
  'build-must-pass': {
    candidatesPerRound: 3,
    roundCap: 3,
    scoreThreshold: 0.5,
    temperatureSchedule: [0.1, 0.4, 0.7],
  },
  'test-must-pass': {
    candidatesPerRound: 3,
    roundCap: 3,
    scoreThreshold: 0.5,
    temperatureSchedule: [0.1, 0.4, 0.7],
  },
  'function-must-have-signature': {
    candidatesPerRound: 2,
    roundCap: 3,
    scoreThreshold: 0.5,
    temperatureSchedule: [0.1, 0.3, 0.6],
  },
  'property-must-hold': {
    candidatesPerRound: 3,
    roundCap: 3,
    scoreThreshold: 0.5,
    temperatureSchedule: [0.1, 0.4, 0.7],
  },
  'import-graph-must-satisfy': {
    candidatesPerRound: 2,
    roundCap: 3,
    scoreThreshold: 0.5,
    temperatureSchedule: [0.1, 0.4, 0.7],
  },
  'coverage-must-exceed': {
    candidatesPerRound: 3,
    roundCap: 3,
    scoreThreshold: 0.5,
    temperatureSchedule: [0.2, 0.5, 0.8],
  },
  'performance-must-not-regress': {
    candidatesPerRound: 2,
    roundCap: 3,
    scoreThreshold: 0.5,
    temperatureSchedule: [0.1, 0.3, 0.6],
  },
};

export interface ApplyOutcome {
  satisfied: boolean;
  detail: string;
}

export interface TournamentCandidate {
  candidateIndex: number;
  personaId: string;
  response: SessionResponse;
  verdict: ScoredCandidate | null;
  responseSha256: string;
  temperature: number;
}

export interface TournamentRound {
  roundIndex: number;
  candidates: TournamentCandidate[];
  usage: SessionUsage;
  winnerIndex: number | null;
}

export interface TournamentResult {
  obligationIndex: number;
  rounds: TournamentRound[];
  satisfied: boolean;
  winner: { roundIndex: number; candidateIndex: number; personaId: string } | null;
  detail: string;
  usage: SessionUsage;
  escalated: boolean;
  bestScore: number;
  verifierCallsSavedByMemoization: number;
  streamingAbortedCandidates: number;
  streamingCharsBeforeAbort: number;
}

export interface TournamentPersonaSlate {
  primary: PersonaSpec[];
  fallback?: PersonaSpec[];
}

export interface RunTournamentOptions {
  obligation: ObligationV1;
  obligationIndex: number;
  session: Session;
  personas: TournamentPersonaSlate;
  config: TournamentConfig;
  renderUserMessage: (
    obligation: ObligationV1,
    persona: PersonaSpec,
    roundIndex: number,
    candidateIndex: number,
  ) => string;
  // Idempotent across rounds; rounds run only when the previous winner
  // failed to satisfy.
  applyCandidate: (
    candidate: TournamentCandidate,
    obligation: ObligationV1,
  ) => Promise<ApplyOutcome>;
  ledgerSink?: TournamentLedgerSink;
  // A candidate whose responseSha256 matches a prior tournament winner
  // of the same obligation type inherits that verdict and skips the
  // verifier call.
  memoStore?: MemoStore;
  // Stream aborts are independent across candidates — one aborting does
  // not cancel the others. Aborted candidates get a synthetic verdict
  // with score -1 so they cannot win.
  streamingAssertions?: readonly StreamingAssertion[];
  costTracker?: LiveCostTracker;
  streamingSink?: TournamentStreamingSink;
}

export interface TournamentStreamingSink {
  recordStreamAborted(args: {
    obligationIndex: number;
    roundIndex: number;
    candidateIndex: number;
    personaId: string;
    partialResponseSha256: string;
    abortedAtChars: number;
    reason: string;
    usageAtAbort: SessionUsage;
    model: string;
  }): void;
}

// Keeps ledger-shape concerns out of the harness so a different store
// (Phase 4 hash-chained ledger) can plug in without touching it.
export interface TournamentLedgerSink {
  recordRoundStarted(args: {
    obligationIndex: number;
    obligationType: string;
    roundIndex: number;
    roundCap: number;
    personaIds: string[];
    temperatures: number[];
  }): void;
  recordCandidate(args: {
    obligationIndex: number;
    roundIndex: number;
    candidateIndex: number;
    personaId: string;
    responseSha256: string;
    usage: SessionUsage;
    model: string;
  }): void;
  recordWinner(args: {
    obligationIndex: number;
    roundIndex: number;
    candidateIndex: number;
    personaId: string;
    responseSha256: string;
    score: number;
    rationale: string;
  }): void;
  recordDiscard(args: {
    obligationIndex: number;
    roundIndex: number;
    candidateIndex: number;
    personaId: string;
    responseSha256: string;
    score: number;
    rationale: string;
    usage: SessionUsage;
    model: string;
  }): void;
  recordEscalation(args: {
    obligationIndex: number;
    obligationType: string;
    roundsRun: number;
    bestScore: number;
    detail: string;
  }): void;
}

export async function runTournament(
  options: RunTournamentOptions,
): Promise<TournamentResult> {
  const { obligation, obligationIndex, session, personas, config, ledgerSink, memoStore } = options;
  const cap = Math.min(Math.max(1, config.roundCap), 3);
  const rounds: TournamentRound[] = [];
  let totalUsage = emptyUsage();
  let bestScore = 0;
  let verifierCallsSavedByMemoization = 0;
  let streamingAbortedCandidates = 0;
  let streamingCharsBeforeAbort = 0;
  const streamingAssertions = options.streamingAssertions ?? [];
  const useStreaming = streamingAssertions.length > 0 || options.costTracker !== undefined;
  // Synthetic verdict for stream-aborted candidates: cannot win a round.
  const streamAbortedVerdict = (reason: string): ScoredCandidate => ({
    score: -1,
    rationale: `stream-aborted: ${reason}`,
    rawText: '',
    usage: emptyUsage(),
    model: 'stream-aborted',
  });

  for (let roundIndex = 0; roundIndex < cap; roundIndex += 1) {
    const slate = pickPersonaSlate(personas, roundIndex, config.candidatesPerRound);
    const tempIdx = config.temperatureSchedule.length === 0 ? 0 : roundIndex % config.temperatureSchedule.length;
    const baseTemp = config.temperatureSchedule[tempIdx] ?? 0.2;

    ledgerSink?.recordRoundStarted({
      obligationIndex,
      obligationType: obligation.type,
      roundIndex,
      roundCap: cap,
      personaIds: slate.map((p) => p.id),
      temperatures: slate.map(() => baseTemp),
    });

    const streamAborts: Array<{ aborted: true; reason: string; outcome: StreamingVerifierOutcome } | null> = [];
    const candidates: TournamentCandidate[] = await Promise.all(
      slate.map(async (persona, candidateIndex): Promise<TournamentCandidate> => {
        const userMessage = options.renderUserMessage(obligation, persona, roundIndex, candidateIndex);
        const sampling = { ...persona.sampling, temperature: baseTemp };
        const sessionRequest = {
          personaId: persona.id,
          personaSystemSuffix: persona.systemSuffix,
          sampling,
          userMessage,
        } as const;
        let response: SessionResponse;
        let aborted = false;
        let abortReason: string | null = null;
        let outcome: StreamingVerifierOutcome | null = null;
        if (useStreaming) {
          outcome = await runStreamingCompletion(
            session,
            sessionRequest,
            obligation,
            streamingAssertions,
            options.costTracker,
          );
          response = outcome.streamResult.response;
          aborted = outcome.aborted;
          abortReason = outcome.abortReason;
        } else {
          response = await session.complete(sessionRequest);
        }
        const responseSha256 = sha256(response.text);
        const candidate: TournamentCandidate = {
          candidateIndex,
          personaId: persona.id,
          response,
          verdict: aborted ? streamAbortedVerdict(abortReason ?? 'unknown') : null,
          responseSha256,
          temperature: baseTemp,
        };
        streamAborts[candidateIndex] = aborted && outcome !== null
          ? { aborted: true, reason: abortReason ?? 'unknown', outcome }
          : null;
        return candidate;
      }),
    );

    // Stream-abort entries come BEFORE candidate-recorded so audit
    // order matches causation.
    for (const c of candidates) {
      const ab = streamAborts[c.candidateIndex];
      if (!ab) continue;
      streamingAbortedCandidates += 1;
      streamingCharsBeforeAbort += ab.outcome.abortedAtChars;
      options.streamingSink?.recordStreamAborted({
        obligationIndex,
        roundIndex,
        candidateIndex: c.candidateIndex,
        personaId: c.personaId,
        partialResponseSha256: c.responseSha256,
        abortedAtChars: ab.outcome.abortedAtChars,
        reason: ab.reason,
        usageAtAbort: c.response.usage,
        model: c.response.model,
      });
    }

    let roundUsage = emptyUsage();
    for (const c of candidates) {
      roundUsage = addUsage(roundUsage, c.response.usage);
      ledgerSink?.recordCandidate({
        obligationIndex,
        roundIndex,
        candidateIndex: c.candidateIndex,
        personaId: c.personaId,
        responseSha256: c.responseSha256,
        usage: c.response.usage,
        model: c.response.model,
      });
    }

    const verdicts: Array<ScoredCandidate | null> = candidates.map(() => null);
    const verdictByHash: Map<string, ScoredCandidate> = new Map();
    const usageCountedHashes = new Set<string>();
    // Stream-aborted verdicts MUST be staked first so an aborted
    // candidate is not silently promoted by a memo-store hash collision.
    for (const c of candidates) {
      if (c.verdict !== null && c.verdict.model === 'stream-aborted') {
        verdictByHash.set(c.responseSha256, c.verdict);
      }
    }
    if (memoStore) {
      for (const c of candidates) {
        if (verdictByHash.has(c.responseSha256)) continue;
        const hit = memoStore.findPriorWinnerByHash(obligation, c.responseSha256);
        if (hit) {
          const priorScore =
            hit.origin.type === 'tournament-winner-selected'
              ? hit.origin.score
              : config.scoreThreshold;
          const synthetic: ScoredCandidate = {
            score: Math.max(config.scoreThreshold, priorScore),
            rationale: `memoized: ${hit.detail}`,
            rawText: '',
            usage: emptyUsage(),
            model: 'memoized',
          };
          verdictByHash.set(c.responseSha256, synthetic);
        }
      }
    }
    const toScoreSerially: TournamentCandidate[] = [];
    for (const c of candidates) {
      if (verdictByHash.has(c.responseSha256)) {
        verifierCallsSavedByMemoization += 1;
        continue;
      }
      // Stake the slot before scoring so later same-hash candidates
      // dedupe against this one.
      verdictByHash.set(c.responseSha256, null as unknown as ScoredCandidate);
      toScoreSerially.push(c);
    }
    const freshVerdicts = await Promise.all(
      toScoreSerially.map((c) => {
        const opts: Parameters<typeof scoreCandidate>[4] = {};
        if (config.verifierPersona !== undefined) opts.persona = config.verifierPersona;
        else opts.persona = TOURNAMENT_VERIFIER_PERSONA;
        if (config.verifierModel !== undefined) opts.model = config.verifierModel;
        return scoreCandidate(session, obligation, c.response.text, c.candidateIndex, opts);
      }),
    );
    for (let i = 0; i < toScoreSerially.length; i += 1) {
      const c = toScoreSerially[i];
      const v = freshVerdicts[i];
      if (!c || !v) continue;
      verdictByHash.set(c.responseSha256, v);
    }
    // Same-hash candidates inherit the verdict but do not double-count
    // its cost into roundUsage.
    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      if (!c) continue;
      const v = verdictByHash.get(c.responseSha256) ?? null;
      verdicts[i] = v;
      if (v) {
        c.verdict = v;
        if (!usageCountedHashes.has(c.responseSha256)) {
          roundUsage = addUsage(roundUsage, v.usage);
          usageCountedHashes.add(c.responseSha256);
        }
        if (v.score > bestScore) bestScore = v.score;
      }
    }

    const ranked = [...candidates].sort((a, b) => (b.verdict?.score ?? 0) - (a.verdict?.score ?? 0));
    const top = ranked[0] ?? null;
    let winnerIndex: number | null = null;
    const discarded = new Set<number>();

    if (top && top.verdict && top.verdict.score >= config.scoreThreshold) {
      const apply = await options.applyCandidate(top, obligation);
      if (apply.satisfied) {
        winnerIndex = top.candidateIndex;
        const winnerInfo: TournamentResult['winner'] = {
          roundIndex,
          candidateIndex: top.candidateIndex,
          personaId: top.personaId,
        };
        ledgerSink?.recordWinner({
          obligationIndex,
          roundIndex,
          candidateIndex: top.candidateIndex,
          personaId: top.personaId,
          responseSha256: top.responseSha256,
          score: top.verdict.score,
          rationale: top.verdict.rationale,
        });
        if (memoStore) {
          memoStore.ingestWinner(
            {
              type: 'tournament-winner-selected',
              ts: new Date().toISOString(),
              runId: '',
              seq: 0,
              prevHash: '',
              entryHash: '',
              obligationIndex,
              roundIndex,
              candidateIndex: top.candidateIndex,
              personaId: top.personaId,
              responseSha256: top.responseSha256,
              score: top.verdict.score,
              rationale: top.verdict.rationale,
            },
            obligation.type,
          );
        }
        for (const c of candidates) {
          if (c.candidateIndex === top.candidateIndex) continue;
          if (!c.verdict) continue;
          ledgerSink?.recordDiscard({
            obligationIndex,
            roundIndex,
            candidateIndex: c.candidateIndex,
            personaId: c.personaId,
            responseSha256: c.responseSha256,
            score: c.verdict.score,
            rationale: c.verdict.rationale,
            usage: c.response.usage,
            model: c.response.model,
          });
        }
        rounds.push({ roundIndex, candidates, usage: roundUsage, winnerIndex });
        totalUsage = addUsage(totalUsage, roundUsage);
        return {
          obligationIndex,
          rounds,
          satisfied: true,
          winner: winnerInfo,
          detail: `tournament won at round ${roundIndex} by ${top.personaId} (score=${top.verdict.score.toFixed(2)}); ${apply.detail}`,
          usage: totalUsage,
          escalated: false,
          bestScore,
          verifierCallsSavedByMemoization,
          streamingAbortedCandidates,
          streamingCharsBeforeAbort,
        };
      }
      // Winner failed application/verification — discard and fall
      // through to the next round (or escalate when cap is hit).
      ledgerSink?.recordDiscard({
        obligationIndex,
        roundIndex,
        candidateIndex: top.candidateIndex,
        personaId: top.personaId,
        responseSha256: top.responseSha256,
        score: top.verdict.score,
        rationale: `apply failed: ${apply.detail}`,
        usage: top.response.usage,
        model: top.response.model,
      });
      discarded.add(top.candidateIndex);
    }

    for (const c of candidates) {
      if (!c.verdict) continue;
      if (discarded.has(c.candidateIndex)) continue;
      ledgerSink?.recordDiscard({
        obligationIndex,
        roundIndex,
        candidateIndex: c.candidateIndex,
        personaId: c.personaId,
        responseSha256: c.responseSha256,
        score: c.verdict.score,
        rationale: c.verdict.rationale,
        usage: c.response.usage,
        model: c.response.model,
      });
    }

    rounds.push({ roundIndex, candidates, usage: roundUsage, winnerIndex });
    totalUsage = addUsage(totalUsage, roundUsage);
  }

  ledgerSink?.recordEscalation({
    obligationIndex,
    obligationType: obligation.type,
    roundsRun: rounds.length,
    bestScore,
    detail: `tournament exhausted ${rounds.length} round(s) without satisfying obligation`,
  });

  return {
    obligationIndex,
    rounds,
    satisfied: false,
    winner: null,
    detail: `tournament escalated after ${rounds.length} round(s); best score ${bestScore.toFixed(2)}`,
    usage: totalUsage,
    escalated: true,
    bestScore,
    verifierCallsSavedByMemoization,
    streamingAbortedCandidates,
    streamingCharsBeforeAbort,
  };
}

// Round 0 uses primaries; later rounds rotate in fallbacks. Repeats
// from primary when the slate is shorter than `count` — the
// "same persona at different temperatures" path.
export function pickPersonaSlate(
  slate: TournamentPersonaSlate,
  roundIndex: number,
  count: number,
): PersonaSpec[] {
  const pool: PersonaSpec[] =
    roundIndex === 0 || (slate.fallback?.length ?? 0) === 0
      ? [...slate.primary]
      : roundIndex % 2 === 1
        ? [...(slate.fallback ?? []), ...slate.primary]
        : [...slate.primary, ...(slate.fallback ?? [])];
  if (pool.length === 0) {
    throw new Error('tournament: empty persona slate');
  }
  const out: PersonaSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const persona = pool[i % pool.length];
    if (persona) out.push(persona);
  }
  return out;
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}
