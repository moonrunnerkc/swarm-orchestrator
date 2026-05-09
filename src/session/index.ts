/**
 * Public surface of the v8 session layer. Phase 2 ships:
 *   - The `Session` abstraction (interface, request/response/usage types).
 *   - `AnthropicSession`: the production prompt-cache-native implementation.
 *   - `StubSession`: deterministic stub for tests and the synthetic benchmark.
 *   - Effective-input-token math used by the run-time UI and the benchmark.
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
