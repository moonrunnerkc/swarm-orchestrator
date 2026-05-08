/**
 * Phase 3 speculative-synthesis tournament harness.
 *
 * For each obligation that requires synthesis (not deterministic
 * transformation), the population manager initiates a tournament:
 * multiple personas generate candidate responses in parallel, the
 * tournament-verifier persona scores them, and the highest-scoring
 * candidate is selected for application. Losers are recorded with their
 * diff hash, score, and token cost; their text is discarded.
 *
 * Diversity injection (impl guide §6): tournament rounds whose top
 * candidate fails to apply or score above threshold rerun with different
 * sampling parameters and may rotate personas. Hard cap at three rounds
 * per obligation; on exhaustion the harness reports an `escalated`
 * outcome and does not commit any candidate.
 *
 * The harness is intentionally agnostic to *what* the persona produces:
 * it accepts an `applyCandidate` callback that knows how to translate the
 * winning response into on-disk changes (file emit for architect, unified
 * diff for implementer/verifier). The applier returns a verification-style
 * result; the harness uses it as the satisfaction signal.
 *
 * See:
 *   - `v8-overhaul-guide.md` §5.3 (speculative synthesis tree)
 *   - `v8-implementation-guide.md` §6 (Phase 3 deliverables)
 */

import * as crypto from 'crypto';
import type { ObligationV1 } from '../contract/types';
import type { Session, SessionResponse, SessionUsage } from '../session/types';
import { addUsage, emptyUsage } from '../session/types';
import type { PersonaSpec } from './../persona/types';
import {
  TOURNAMENT_VERIFIER_PERSONA,
  scoreCandidate,
  type ScoredCandidate,
} from './../persona/verifier-persona';

/**
 * Per-obligation-type tournament configuration. The defaults match impl
 * guide §6 (2–4 candidates, 3-round cap with diversity injection).
 */
export interface TournamentConfig {
  /** Number of candidates per round. Defaults vary by obligation type. */
  candidatesPerRound: number;
  /** Maximum number of rounds before escalating. Hard cap 3. */
  roundCap: number;
  /**
   * Score threshold a winner must clear. Below this, the round is
   * considered a wash and diversity injection takes over (or escalation
   * if the cap is hit).
   */
  scoreThreshold: number;
  /**
   * Per-round temperature schedule. Round k uses index `k mod length`.
   * Diversity-injection knob: temperatures should differ across rounds.
   */
  temperatureSchedule: number[];
  /** Tournament-verifier persona override. Defaults to `tournament-verifier`. */
  verifierPersona?: PersonaSpec;
  /** Verifier model id override (e.g. specific haiku revision). */
  verifierModel?: string;
}

/**
 * Default tournament configurations per obligation type. File-must-exist
 * uses a smaller candidate pool (architect personas tend to converge);
 * build/test obligations get the wider pool because they involve more
 * subtle decisions.
 */
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
};

/** Outcome a candidate-application step reports back to the tournament. */
export interface ApplyOutcome {
  /** True when the application + verification step succeeded. */
  satisfied: boolean;
  /** Human-readable note for the ledger. */
  detail: string;
}

/**
 * Generation candidate the tournament considers. The harness records the
 * full response text plus token usage and the response hash; the text is
 * applied only if the candidate wins and verifies.
 */
export interface TournamentCandidate {
  candidateIndex: number;
  personaId: string;
  /** Full session response, kept so the winner can be applied verbatim. */
  response: SessionResponse;
  /** Verifier score; only populated after `scoreCandidate`. */
  verdict: ScoredCandidate | null;
  /** Sha256 of `response.text`. */
  responseSha256: string;
  /** Sampling temperature used for this candidate. */
  temperature: number;
}

/** Round of a tournament: candidates plus their verdicts. */
export interface TournamentRound {
  roundIndex: number;
  candidates: TournamentCandidate[];
  /** Round usage (generation calls + verifier calls). */
  usage: SessionUsage;
  /** Index into `candidates` of the round's winner, or null if all losers. */
  winnerIndex: number | null;
}

/** Aggregate result of a tournament for a single obligation. */
export interface TournamentResult {
  obligationIndex: number;
  /** All rounds that ran, in order. */
  rounds: TournamentRound[];
  /** True when a winning candidate satisfied the obligation. */
  satisfied: boolean;
  /** Round and candidate index of the satisfying winner, or null. */
  winner: { roundIndex: number; candidateIndex: number; personaId: string } | null;
  /** Free-form detail: satisfied/escalated/not-satisfied reason. */
  detail: string;
  /** Summed usage for every generation + verifier call across all rounds. */
  usage: SessionUsage;
  /** True when the harness exhausted the round cap without a satisfier. */
  escalated: boolean;
  /** Best score observed across every round (for the escalation report). */
  bestScore: number;
}

/** Persona slate the harness draws from per round. */
export interface TournamentPersonaSlate {
  /** Primary personas for round 0. */
  primary: PersonaSpec[];
  /** Optional fallback personas for diversity injection (round ≥1). */
  fallback?: PersonaSpec[];
}

export interface RunTournamentOptions {
  /** The obligation under tournament. */
  obligation: ObligationV1;
  /** Index in the original contract obligation list (for ledger). */
  obligationIndex: number;
  /** Session every persona dispatches against. */
  session: Session;
  /** Persona slate. The harness rotates by round mod slate length. */
  personas: TournamentPersonaSlate;
  /** Tournament configuration. */
  config: TournamentConfig;
  /**
   * Build the per-call user message for a candidate. Generally identical
   * to the population manager's `renderDynamicMessage`; passed in so the
   * harness can inject diversity-flavoured framing per round if needed.
   */
  renderUserMessage: (
    obligation: ObligationV1,
    persona: PersonaSpec,
    roundIndex: number,
    candidateIndex: number,
  ) => string;
  /**
   * Apply the winning candidate's response to the workspace and run
   * verification. Returns `{satisfied}` based on the verifier outcome.
   * Called once per round, only on the round winner. The applier should
   * be idempotent across rounds; rounds run only when the previous
   * winner failed to satisfy.
   */
  applyCandidate: (
    candidate: TournamentCandidate,
    obligation: ObligationV1,
  ) => Promise<ApplyOutcome>;
  /** Optional ledger sink. The harness emits round/winner/discard entries via this. */
  ledgerSink?: TournamentLedgerSink;
}

/**
 * Hooks the harness uses to record tournament evidence. Keeps the
 * ledger-shape concern out of the harness module so a different storage
 * (Phase 4 hash-chained ledger) can plug in without touching the harness.
 */
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

/**
 * Run a tournament for a single obligation. Returns the aggregated
 * result; callers (the population manager) are responsible for treating
 * the outcome as satisfaction in the contract state and recording any
 * higher-level ledger framing.
 */
export async function runTournament(
  options: RunTournamentOptions,
): Promise<TournamentResult> {
  const { obligation, obligationIndex, session, personas, config, ledgerSink } = options;
  const cap = Math.min(Math.max(1, config.roundCap), 3);
  const rounds: TournamentRound[] = [];
  let totalUsage = emptyUsage();
  let bestScore = 0;

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

    // Generate candidates in parallel.
    const candidates: TournamentCandidate[] = await Promise.all(
      slate.map(async (persona, candidateIndex): Promise<TournamentCandidate> => {
        const userMessage = options.renderUserMessage(obligation, persona, roundIndex, candidateIndex);
        const sampling = { ...persona.sampling, temperature: baseTemp };
        const response = await session.complete({
          personaId: persona.id,
          personaSystemSuffix: persona.systemSuffix,
          sampling,
          userMessage,
        });
        const responseSha256 = sha256(response.text);
        const candidate: TournamentCandidate = {
          candidateIndex,
          personaId: persona.id,
          response,
          verdict: null,
          responseSha256,
          temperature: baseTemp,
        };
        return candidate;
      }),
    );

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

    // Score every candidate via the cheap tournament verifier.
    const verdicts = await Promise.all(
      candidates.map((c) => {
        const opts: Parameters<typeof scoreCandidate>[4] = {};
        if (config.verifierPersona !== undefined) opts.persona = config.verifierPersona;
        else opts.persona = TOURNAMENT_VERIFIER_PERSONA;
        if (config.verifierModel !== undefined) opts.model = config.verifierModel;
        return scoreCandidate(session, obligation, c.response.text, c.candidateIndex, opts);
      }),
    );
    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      const v = verdicts[i];
      if (!c || !v) continue;
      c.verdict = v;
      roundUsage = addUsage(roundUsage, v.usage);
      if (v.score > bestScore) bestScore = v.score;
    }

    // Pick the highest-scoring candidate.
    const ranked = [...candidates].sort((a, b) => (b.verdict?.score ?? 0) - (a.verdict?.score ?? 0));
    const top = ranked[0] ?? null;
    let winnerIndex: number | null = null;
    /** Candidate indices already discarded in this round (avoid double-record). */
    const discarded = new Set<number>();

    if (top && top.verdict && top.verdict.score >= config.scoreThreshold) {
      // Apply and verify the winner.
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
        // Discard everyone else (i.e. record the losers).
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
        };
      }
      // Winner was selected but failed application/verification — discard
      // and fall through to the next round (or escalate when cap hit).
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

    // Discard every candidate that hasn't already been discarded above.
    // When threshold isn't met, this includes top; when threshold passed
    // but apply failed, top is in `discarded` and skipped here.
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

  // Cap reached without a satisfier.
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
  };
}

/**
 * Pick `count` personas from the slate for the given round. Round 0 uses
 * primaries; later rounds rotate in fallbacks for diversity injection.
 * Repeats from primary if the slate is shorter than `count`; this is the
 * "two of the same persona at different temperatures" path.
 */
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
