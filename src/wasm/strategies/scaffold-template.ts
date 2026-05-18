/**
 * `scaffold-template` strategy: create a file from a registered
 * boilerplate template. Template selection is keyed by the basename or
 * extension of the obligation's path. When no template matches the
 * obligation reroutes to synthesis (impl guide §8 misclassification
 * recovery).
 *
 * Phase 5 ships a small in-repo template set covering the boilerplate
 * file types the §8 spec calls out (license headers, file naming
 * conventions, scaffolds). Additional templates are registered via
 * `registerTemplate`.
 *
 * The template data and lookup functions have been moved to
 * src/shared-wasm/strategy-constants.ts to break the circular
 * dependency between contract and wasm. This file re-exports them
 * for backward compatibility.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ObligationV1 } from '../../shared-types/obligation-types';
import {
  getTemplate,
  hasTemplateFor,
  registerTemplate,
  listTemplateKeys,
} from '../../shared-wasm/strategy-constants';
import { ensureInsideRepoRoot } from '../wasm-runtime';
import type { DeterministicStrategy, StrategyContext, StrategyResult } from '../types';

// Re-export for backward compatibility — consumers that imported
// these from '../wasm/strategies/scaffold-template' still work.
export { hasTemplateFor, registerTemplate, listTemplateKeys };

/** The strategy implementation. */
export const scaffoldTemplateStrategy: DeterministicStrategy = {
  name: 'scaffold-template',
  description: 'Create a file from a registered boilerplate template.',
  handles: ['file-must-exist'] as const,
  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const obligation = ctx.obligation;
    if (obligation.type !== 'file-must-exist') {
      throw new Error(
        `scaffold-template only handles file-must-exist; got ${obligation.type}`,
      );
    }
    const relPath = obligation.path;
    const template = getTemplate(relPath);
    if (template === null) {
      throw new Error(
        `no template registered for ${relPath} (basename or extension lookup miss)`,
      );
    }
    const abs = ensureInsideRepoRoot(ctx.repoRoot, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (fs.existsSync(abs)) {
      return {
        applied: false,
        detail: `${relPath} already exists; scaffold-template is non-destructive`,
        filesAffected: [],
      };
    }
    const body = template.endsWith('\n') ? template : template + '\n';
    fs.writeFileSync(abs, body, 'utf8');
    return {
      applied: true,
      detail: `wrote ${relPath} from registered template`,
      filesAffected: [relPath],
    };
  },
};

/** Type guard: confirm the obligation is one this strategy can take on. */
export function canScaffold(o: ObligationV1): boolean {
  return o.type === 'file-must-exist' && hasTemplateFor(o.path);
}