// Injects a context-losing rethrow: replaces `throw err` with a fresh
// Error that drops the cause, erasing the original stack and message.

import type { Injector, InjectionInput, InjectionPlan } from './injector-types';
import { ctx, del, add } from './injector-types';
import { pickCarrier, isSourcePath, alreadyContains } from './diff-carrier';
import { tagOf } from './site';

export const exceptionRethrowLostContextInjector: Injector = {
  id: 'exception-rethrow-lost-context',
  category: 'exception-rethrow-lost-context',
  description: 'Rethrow a new Error without { cause }, discarding the original error.',
  plan(input: InjectionInput): InjectionPlan | null {
    const carrier = pickCarrier(input.files, isSourcePath, input.seed);
    if (carrier === undefined) return null;
    if (alreadyContains(input.cleanDiff, /throw new Error\([^)]*\{\s*cause/)) return null;
    const tag = tagOf(input, this.id);
    return {
      file: carrier,
      isNewFile: false,
      lines: [
        ctx(`export function op_${tag}(x: number) {`),
        ctx(`  try {`),
        ctx(`    return inner_${tag}(x);`),
        ctx(`  } catch (err) {`),
        del(`    throw err;`),
        add(`    throw new Error('op_${tag} failed');`),
        ctx(`  }`),
        ctx(`}`),
      ],
    };
  },
};
