// Injects a comment-only fix: a hunk that adds only a comment
// acknowledging the bug, with no change to the code path.

import type { Injector, InjectionInput, InjectionPlan } from './injector-types';
import { ctx, add } from './injector-types';
import { pickCarrier, isSourcePath } from './diff-carrier';
import { tagOf } from './site';

export const commentOnlyFixInjector: Injector = {
  id: 'comment-only-fix',
  category: 'comment-only-fix',
  description: 'Add only a comment noting the bug while leaving the code path unchanged.',
  plan(input: InjectionInput): InjectionPlan | null {
    const carrier = pickCarrier(input.files, isSourcePath, input.seed);
    if (carrier === undefined) return null;
    const tag = tagOf(input, this.id);
    return {
      file: carrier,
      isNewFile: false,
      lines: [
        ctx(`export function widget_${tag}() {`),
        add(`  // FIXME: still returns the wrong value, needs a real fix`),
        ctx(`  return cachedValue_${tag};`),
        ctx(`}`),
      ],
    };
  },
};
