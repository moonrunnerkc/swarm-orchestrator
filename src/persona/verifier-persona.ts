/**
 * Phase 3: Haiku-tier tournament verifier persona. Scores candidate
 * synthesis output against a single obligation's contract assertions and
 * returns a structured score plus a brief rationale.
 *
 * Distinct from the legacy `VERIFIER_PERSONA` in `persona-registry.ts`,
 * which is the dispatch persona that handles `test-must-pass` obligations
 * during synthesis. The tournament verifier never writes patches; its only
 * job is to rank candidates produced by other personas. See
 * `v8-implementation-guide.md` §6 (Phase 3 — `src/persona/verifier-persona.ts`).
 */
import type { ObligationV1 } from '../contract/types';
import type { Session, SessionUsage } from '../session/types';
import type { PersonaSpec } from './types';

/**
 * Structured tournament verdict for a single candidate. `score` is in
 * [0, 1]; higher is better. `rationale` is a short prose summary the
 * ledger captures alongside the score.
 */
export interface VerifierScore {
  score: number;
  rationale: string;
  /** Raw verifier text, kept for ledger forensics. */
  rawText: string;
}

/** Verifier output augmented with the session usage charged for the call. */
export interface ScoredCandidate extends VerifierScore {
  usage: SessionUsage;
  model: string;
}

/**
 * The tournament verifier persona. Cheap (`haiku`), low-temperature, capped
 * output: the verifier should be terse and parseable, not eloquent.
 */
export const TOURNAMENT_VERIFIER_PERSONA: PersonaSpec = {
  id: 'tournament-verifier',
  role: 'tournament-verifier',
  systemSuffix: [
    'You are the tournament verifier persona in the swarm-orchestrator v8',
    'population. Score a single candidate diff against the obligation it',
    'aims to satisfy and emit a strict JSON envelope on a single line:',
    '',
    '  {"score": <0..1>, "rationale": "<≤140 chars>"}',
    '',
    'Scoring rubric:',
    '- 1.0 — candidate clearly satisfies the obligation, low risk of regression.',
    '- 0.7-0.9 — candidate satisfies the obligation but has cosmetic concerns.',
    '- 0.4-0.6 — candidate partially addresses the obligation.',
    '- 0.0-0.3 — candidate is wrong, empty, or actively harmful.',
    '',
    'Output the JSON envelope and nothing else. No prose, no fences, no preamble.',
  ].join('\n'),
  sampling: { temperature: 0.0, maxTokens: 256 },
  tier: 'haiku',
  // The tournament verifier doesn't dispatch on obligations directly — it
  // is invoked imperatively by the tournament harness — so `handles` is
  // intentionally empty. The persona registry's selection walk skips it.
  handles: [] as const,
};

/**
 * Build the per-call user message asked of the tournament verifier. The
 * obligation is rendered alongside the candidate text so the verifier has
 * everything it needs in one shot.
 */
export function renderVerifierPrompt(
  obligation: ObligationV1,
  candidateText: string,
  candidateIndex: number,
): string {
  const lines = [
    `Obligation:`,
    JSON.stringify(obligation),
    '',
    `Candidate index: ${candidateIndex}`,
    'Candidate response (verbatim, between markers):',
    '<<<CANDIDATE',
    candidateText,
    'CANDIDATE>>>',
    '',
    'Score this candidate. Output the strict JSON envelope only.',
  ];
  return lines.join('\n');
}

/**
 * Parse a verifier response. Tolerates trailing whitespace and an optional
 * fenced ```json wrapper that less-disciplined models sometimes emit.
 * Falls back to the (0, "unparseable") verdict when no JSON is found,
 * which deterministically loses against any structured candidate. The raw
 * text is preserved on the score so the ledger can still attribute the
 * failure mode.
 */
export function parseVerifierScore(rawText: string): VerifierScore {
  const trimmed = rawText.trim();
  // Strip optional ```json fence.
  const fenceStripped = trimmed
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  // Find the first balanced top-level JSON object.
  const objMatch = fenceStripped.match(/\{[\s\S]*\}/);
  if (!objMatch) {
    return { score: 0, rationale: 'verifier returned no JSON envelope', rawText };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(objMatch[0]);
  } catch (err) {
    return {
      score: 0,
      rationale: `verifier JSON parse error: ${(err as Error).message.slice(0, 80)}`,
      rawText,
    };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { score: 0, rationale: 'verifier JSON was not an object', rawText };
  }
  const obj = parsed as Record<string, unknown>;
  const rawScore = obj['score'];
  const rawRationale = obj['rationale'];
  const score = clampScore(rawScore);
  const rationale =
    typeof rawRationale === 'string' && rawRationale.length > 0
      ? rawRationale.slice(0, 240)
      : 'no rationale';
  return { score, rationale, rawText };
}

/**
 * Clamp a parsed score into [0, 1]. Non-numeric or NaN inputs map to 0;
 * out-of-range inputs are clamped (a verifier that emits 1.5 still loses
 * to 1.0 rather than winning by surprise).
 */
export function clampScore(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Score a single candidate by dispatching the tournament verifier persona
 * against the supplied session. The session's usage accounting captures
 * the verifier's cost for cost attribution.
 */
export async function scoreCandidate(
  session: Session,
  obligation: ObligationV1,
  candidateText: string,
  candidateIndex: number,
  options: { persona?: PersonaSpec; model?: string } = {},
): Promise<ScoredCandidate> {
  const persona = options.persona ?? TOURNAMENT_VERIFIER_PERSONA;
  const request: Parameters<Session['complete']>[0] = {
    personaId: persona.id,
    personaSystemSuffix: persona.systemSuffix,
    sampling: { ...persona.sampling },
    userMessage: renderVerifierPrompt(obligation, candidateText, candidateIndex),
  };
  if (options.model !== undefined) request.model = options.model;
  const response = await session.complete(request);
  const score = parseVerifierScore(response.text);
  return {
    ...score,
    usage: response.usage,
    model: response.model,
  };
}
