// Injects a dead branch: an `if (false)` guard that can never run, padding
// the diff with code that looks like a fix but is unreachable.

import type { Injector, InjectionInput, InjectionPlan } from './injector-types';
import { ctx, add } from './injector-types';
import { pickCarrier, isSourcePath } from './diff-carrier';
import { tagOf } from './site';

export const deadBranchInsertionInjector: Injector = {
  id: 'dead-branch-insertion',
  category: 'dead-branch-insertion',
  description: 'Insert an if(false) branch that is unreachable by construction.',
  plan(input: InjectionInput): InjectionPlan | null {
    const carrier = pickCarrier(input.files, isSourcePath, input.seed);
    if (carrier === undefined) return null;
    const tag = tagOf(input, this.id);
    return {
      file: carrier,
      isNewFile: false,
      lines: [
        ctx(`export function route_${tag}(x: number) {`),
        add(`  if (false) {`),
        add(`    return handleEdge_${tag}(x);`),
        add(`  }`),
        ctx(`  return x;`),
        ctx(`}`),
      ],
    };
  },
};
