/**
 * Phase 5 contract auto-tagger. Inspects each obligation and, when a
 * registered deterministic strategy can plausibly satisfy it, attaches
 * the `deterministicStrategy` tag. The tagger is conservative: it only
 * tags when the strategy's preconditions are visible from the
 * obligation alone (e.g., "the path is a known boilerplate file"). When
 * no clear signal exists, the obligation stays untagged and falls
 * through to synthesis.
 *
 * The tagger never overrides an existing tag; user-edited contracts
 * with explicit tags pass through unchanged. The §8 misclassification
 * recovery path covers the case where a tag turns out to be wrong:
 * the strategy fails, the obligation reroutes to synthesis, the
 * ledger captures the failure for later analysis.
 */

import * as path from 'path';
import {
  hasTemplateFor,
} from '../shared-wasm/strategy-constants';
import type { ObligationV1 } from './types';

export interface TaggerOptions {
  /** Available strategy names; only these may be assigned. */
  availableStrategies: readonly string[];
}

/**
 * Tag every obligation in the list. Returns a new array; input is
 * never mutated. Each obligation either gets a `deterministicStrategy`
 * filled in (when the heuristic fires AND the strategy is registered)
 * or is returned untouched.
 */
export function tagObligations(
  obligations: readonly ObligationV1[],
  options: TaggerOptions,
): ObligationV1[] {
  const available = new Set(options.availableStrategies);
  return obligations.map((o) => tagOne(o, available));
}

function tagOne(o: ObligationV1, available: ReadonlySet<string>): ObligationV1 {
  if (o.deterministicStrategy !== undefined) return o;
  if (o.type !== 'file-must-exist') return o;
  const candidate = pickStrategyForFile(o.path, available);
  if (candidate === null) return o;
  return { ...o, deterministicStrategy: candidate };
}

/**
 * Pick the most specific strategy that fits a `file-must-exist` path.
 * Priority order:
 *   1. `scaffold-template` if a registered template basename / extension
 *      matches the path. This covers boilerplate (LICENSE, .gitignore,
 *      README.md, CHANGELOG.md, .editorconfig, plain .md/.txt scaffolds).
 *
 * `import-sort` and `format-prettier` are NOT auto-tagged on the
 * file-must-exist path: import-sort needs an existing file to be
 * useful, and format-prettier on a brand-new file with empty content
 * just produces an empty newline, which the user almost never wants by
 * default. Both remain available for explicit tagging via contract
 * editing.
 */
export function pickStrategyForFile(
  relPath: string,
  available: ReadonlySet<string>,
): string | null {
  if (available.has('scaffold-template') && hasTemplateFor(relPath)) {
    return 'scaffold-template';
  }
  return null;
}

/**
 * Diagnostic helper. Returns counts of how many obligations got tagged
 * and how many were left for synthesis. Used by the CLI to surface a
 * one-line summary after compilation.
 */
export function tagSummary(
  before: readonly ObligationV1[],
  after: readonly ObligationV1[],
): { tagged: number; untagged: number; byStrategy: Record<string, number> } {
  if (before.length !== after.length) {
    throw new Error(
      `tagSummary expects parallel arrays; before.length=${before.length} after.length=${after.length}`,
    );
  }
  const byStrategy: Record<string, number> = {};
  let tagged = 0;
  for (let i = 0; i < after.length; i += 1) {
    const a = after[i];
    if (!a) continue;
    if (a.deterministicStrategy !== undefined) {
      tagged += 1;
      byStrategy[a.deterministicStrategy] = (byStrategy[a.deterministicStrategy] ?? 0) + 1;
    }
  }
  return { tagged, untagged: after.length - tagged, byStrategy };
}

/** Pure helper: is this filename a known auto-taggable boilerplate? */
export function isKnownBoilerplate(relPath: string): boolean {
  return hasTemplateFor(path.basename(relPath));
}
