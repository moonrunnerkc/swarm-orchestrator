// Judge prompt registry. The active set is the default unless
// SWARM_JUDGE_PROMPT_VERSION names another committed version, which is how
// the calibration harness swaps wording without touching call sites.
// Versions are additive: add a file, register it here, never edit an
// existing version in place.

import type { JudgePromptSet } from './types';
import { v1Conservative } from './v1-conservative';
import { v2Balanced } from './v2-balanced';

export const JUDGE_PROMPT_SETS: Readonly<Record<string, JudgePromptSet>> = {
  'v1-conservative': v1Conservative,
  'v2-balanced': v2Balanced,
};

// Chosen by the calibration run (see benchmarks/oracle-corpus/judge-calibration.md):
// v2-balanced reaches higher held-out recall but triples the false-positive
// rate on presumed-clean reals (30% vs 10%), outside the +1pp tolerance, so
// v1-conservative is the knee and stays the default. v2-balanced is kept as
// a committed, selectable version (SWARM_JUDGE_PROMPT_VERSION=v2-balanced).
export const DEFAULT_JUDGE_PROMPT_VERSION = 'v1-conservative';

export function getJudgePromptSet(version?: string): JudgePromptSet {
  const key = version ?? process.env.SWARM_JUDGE_PROMPT_VERSION ?? DEFAULT_JUDGE_PROMPT_VERSION;
  return JUDGE_PROMPT_SETS[key] ?? JUDGE_PROMPT_SETS[DEFAULT_JUDGE_PROMPT_VERSION] ?? v1Conservative;
}

export type { JudgePromptSet } from './types';
