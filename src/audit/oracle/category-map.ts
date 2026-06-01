// Single source of truth for "which path is supposed to catch an injected
// defect of category X". The recall computation reads this; the
// category-mapping test asserts every injector category resolves to a
// detector or the judge-primary path, so a new injector cannot land
// without a way to be scored.
//
// Structural categories map to the same-named detector. The two semantic
// categories have no structural detector and resolve to the judge-primary
// path: that asymmetry is the whole point of the oracle.

import type { CheatCategory, SemanticCheatCategory } from '../types';
import type { OracleCategory } from './inject/injector-types';

export type CatchPath =
  | { kind: 'detector'; detector: CheatCategory }
  | { kind: 'judge-primary'; category: SemanticCheatCategory };

const SEMANTIC: ReadonlySet<string> = new Set(['goal-not-fixed', 'cheat-mock-mutation']);

export function catchPathFor(category: OracleCategory): CatchPath {
  if (SEMANTIC.has(category)) {
    return { kind: 'judge-primary', category: category as SemanticCheatCategory };
  }
  // Every structural injector category is itself a detector category.
  return { kind: 'detector', detector: category as CheatCategory };
}

export function isSemanticCategory(category: string): category is SemanticCheatCategory {
  return SEMANTIC.has(category);
}
