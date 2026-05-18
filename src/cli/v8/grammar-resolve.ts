import { type LocalGrammarMode } from './local-provider-types';

/**
 * Per-consumer grammar capability resolution.
 *
 * The single `--local-grammar` flag is consumed by two independent
 * downstream pieces: the extractor (which accepts `auto`, `json-schema`,
 * `none`) and the session (which accepts every value the flag parser
 * permits). When a user-supplied value cannot be honored by a consumer,
 * the resolver substitutes `auto` for THAT consumer and surfaces a
 * structured `GrammarCoercion` record so the caller can emit a single
 * stderr warning before any inference call runs.
 *
 * Splitting the flag into per-consumer flags was considered and
 * rejected: it doubles the CLI surface for a capability that almost
 * always matches between consumers. Coercion plus explicit warning is
 * the documented behavior.
 */

/** Grammar values the extractor consumer accepts. */
export const EXTRACTOR_GRAMMARS: readonly LocalGrammarMode[] = [
  'auto',
  'json-schema',
  'none',
] as const;

/** Grammar values the session consumer accepts. */
export const SESSION_GRAMMARS: readonly LocalGrammarMode[] = [
  'auto',
  'gbnf',
  'json-schema',
  'outlines',
  'none',
] as const;

/** Consumer identifiers exposed to the warning emitter. */
type GrammarConsumer = 'extractor' | 'session';

/**
 * Records that a user-supplied grammar value was coerced for a specific
 * consumer because that consumer cannot honor it. The caller emits one
 * warning per record via {@link formatGrammarWarning}.
 */
interface GrammarCoercion {
  /** Consumer that could not honor the requested value. */
  consumer: GrammarConsumer;
  /** Value the user supplied. */
  requested: LocalGrammarMode;
  /** Value the consumer will actually use. Always `auto`. */
  effective: 'auto';
  /** Accepted values for the consumer, for the corrective hint. */
  accepted: readonly LocalGrammarMode[];
  /**
   * What the OTHER consumer does with the same requested value. Either
   * `'honored'` (the other consumer accepts it as-is) or `'coerced'`
   * (the other consumer also can't honor it). Drives the second sentence
   * of the warning text.
   */
  peerConsumerOutcome: 'honored' | 'coerced';
  /** The other consumer's identifier. Used in the second sentence. */
  peerConsumer: GrammarConsumer;
}

/** Grammar values the extractor accepts. */
type ExtractorGrammar = 'auto' | 'json-schema' | 'none';

/** Grammar values the session accepts (every value the parser allows). */
type SessionGrammar = LocalGrammarMode;

/** Result of resolving a user-supplied grammar for a single consumer. */
interface GrammarResolution<T extends LocalGrammarMode> {
  /** Effective grammar value for the consumer. Null when the user passed null. */
  effective: T | null;
  /** Present when the requested value was coerced; null otherwise. */
  coercion: GrammarCoercion | null;
}

const ACCEPTED_BY_CONSUMER: Readonly<Record<GrammarConsumer, readonly LocalGrammarMode[]>> = {
  extractor: EXTRACTOR_GRAMMARS,
  session: SESSION_GRAMMARS,
};

/**
 * Resolve the effective grammar value for a single consumer.
 *
 * - When `requested` is null, returns `{ effective: null, coercion: null }`
 *   so the downstream factory applies its own default.
 * - When the consumer accepts `requested`, returns the value unchanged.
 * - When the consumer cannot honor `requested`, returns `auto` and a
 *   `GrammarCoercion` record. The record also reports how the peer
 *   consumer (extractor for session, session for extractor) handles the
 *   same value so the warning text can communicate both effects.
 */
export function resolveGrammarForConsumer(
  consumer: 'extractor',
  requested: LocalGrammarMode | null,
): GrammarResolution<ExtractorGrammar>;
export function resolveGrammarForConsumer(
  consumer: 'session',
  requested: LocalGrammarMode | null,
): GrammarResolution<SessionGrammar>;
export function resolveGrammarForConsumer(
  consumer: GrammarConsumer,
  requested: LocalGrammarMode | null,
): GrammarResolution<LocalGrammarMode> {
  if (requested === null) return { effective: null, coercion: null };
  const accepted = ACCEPTED_BY_CONSUMER[consumer];
  if (accepted.includes(requested)) {
    return { effective: requested, coercion: null };
  }
  const peer: GrammarConsumer = consumer === 'extractor' ? 'session' : 'extractor';
  const peerAccepted = ACCEPTED_BY_CONSUMER[peer];
  return {
    effective: 'auto',
    coercion: {
      consumer,
      requested,
      effective: 'auto',
      accepted,
      peerConsumerOutcome: peerAccepted.includes(requested) ? 'honored' : 'coerced',
      peerConsumer: peer,
    },
  };
}

/**
 * Format a {@link GrammarCoercion} as the user-facing warning string
 * (without a trailing newline). The caller writes it to stderr.
 *
 * Two formats, mirroring the prompt specification:
 *
 *   - Peer honored:
 *     `warning: --local-grammar=gbnf does not apply to the extractor
 *      (extractor accepts: auto, json-schema, none); extractor will use
 *      'auto'. Session will use 'gbnf' as requested.`
 *
 *   - Peer also coerced:
 *     `warning: --local-grammar=<v> does not apply to the extractor or
 *      the session (extractor accepts: ...; session accepts: ...); both
 *      will use 'auto'.`
 */
export function formatGrammarWarning(c: GrammarCoercion): string {
  if (c.peerConsumerOutcome === 'honored') {
    const peerCap = c.peerConsumer.charAt(0).toUpperCase() + c.peerConsumer.slice(1);
    return (
      `warning: --local-grammar=${c.requested} does not apply to the ${c.consumer} ` +
      `(${c.consumer} accepts: ${c.accepted.join(', ')}); ` +
      `${c.consumer} will use 'auto'. ${peerCap} will use '${c.requested}' as requested.`
    );
  }
  return (
    `warning: --local-grammar=${c.requested} does not apply to the extractor ` +
    `(extractor accepts: ${EXTRACTOR_GRAMMARS.join(', ')}) ` +
    `or the session (session accepts: ${SESSION_GRAMMARS.join(', ')}); ` +
    `both consumers will use 'auto'.`
  );
}
