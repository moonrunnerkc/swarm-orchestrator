/**
 * Type definitions for the v8 persona layer. A persona is a system-prompt
 * slice plus a sampling configuration plus a model-tier preference.
 */

import type { ObligationType } from '../contract/types';

/** Coarse model tiers used to dispatch to a price/quality regime. */
export type ModelTier = 'haiku' | 'sonnet' | 'opus';

/** Sampling regime for a persona. */
export interface PersonaSampling {
  /** Sampling temperature in [0, 1+]. Lower is more deterministic. */
  temperature: number;
  /** Optional top-p override. Omitted by default. */
  topP?: number;
  /** Output token cap. */
  maxTokens: number;
}

/**
 * Static persona definition. The registry holds the system slice,
 * sampling regime, and tier preference for each persona.
 */
export interface PersonaSpec {
  /** Stable id used in the ledger and CLI output. */
  id: string;
  /** Human-readable role tag. */
  role: 'architect' | 'implementer' | 'verifier' | string;
  /** System-prompt slice appended after the cached project context. */
  systemSuffix: string;
  /** Sampling regime. */
  sampling: PersonaSampling;
  /** Preferred model tier; the run-time may map this to a concrete model id. */
  tier: ModelTier;
  /**
   * Obligation types this persona is suited to take on. The predicate
   * evaluator uses this to wake the right persona for each obligation.
   */
  handles: readonly ObligationType[];
}
