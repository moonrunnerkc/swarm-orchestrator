/**
 * Public surface of the v8 session layer. Phase 2 ships:
 *   - The `Session` abstraction (interface, request/response/usage types).
 *   - `AnthropicSession`: the production prompt-cache-native implementation.
 *   - `StubSession`: internal-only synthetic session for tests and the
 *     synthetic benchmark; not reachable from any CLI flag.
 *   - `estimateTokens`: the four-chars-per-token estimator used by the
 *     live cost tracker and the stub session.
 */

export {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  addUsage,
  cacheHitRate,
  effectiveInputTokens,
  emptyUsage,
  type Session,
  type SessionRequest,
  type SessionResponse,
  type SessionUsage,
} from './types';

export {
  AnthropicSession,
  DEFAULT_SESSION_MODEL,
  readAnthropicUsage,
  type AnthropicSessionOptions,
} from './anthropic-session';

export { StubSession, estimateTokens, type StubResponder, type StubSessionOptions } from './stub-session';
