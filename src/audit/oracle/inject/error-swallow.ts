// Injects a swallowed error: a try wrapping a real call with an empty
// catch that discards the failure a caller would need to see.

import type { Injector, InjectionInput, InjectionPlan } from './injector-types';
import { add, ctx } from './injector-types';
import { pickCarrier, isSourcePath, alreadyContains } from './diff-carrier';
import { tagOf } from './site';

export const errorSwallowInjector: Injector = {
  id: 'error-swallow',
  category: 'error-swallow',
  description: 'Wrap a call in try/catch with an empty catch that discards the error.',
  plan(input: InjectionInput): InjectionPlan | null {
    const carrier = pickCarrier(input.files, isSourcePath, input.seed);
    if (carrier === undefined) return null;
    if (alreadyContains(input.cleanDiff, /catch\s*(\([^)]*\))?\s*\{\s*\}/)) return null;
    const tag = tagOf(input, this.id);
    return {
      file: carrier,
      isNewFile: false,
      lines: [
        ctx(`export function persist_${tag}(payload: unknown) {`),
        add(`  try {`),
        ctx(`    writeThrough_${tag}(payload);`),
        add(`  } catch {}`),
        ctx(`}`),
      ],
    };
  },
};
