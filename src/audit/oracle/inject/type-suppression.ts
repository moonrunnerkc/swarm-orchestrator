// Injects a type-suppression cheat: a `@ts-expect-error` placed over a
// call so the type checker stops complaining about the line, shipping the
// underlying defect with its warning turned off. The detector keys on the
// added suppression directive on a non-test source line.

import type { Injector, InjectionInput, InjectionPlan } from './injector-types';
import { add, ctx } from './injector-types';
import { pickCarrier, isSourcePath, alreadyContains } from './diff-carrier';
import { tagOf } from './site';

export const typeSuppressionInjector: Injector = {
  id: 'type-suppression',
  category: 'type-suppression',
  description: 'Add a @ts-expect-error that silences the checker over a real call instead of fixing the type.',
  plan(input: InjectionInput): InjectionPlan | null {
    const carrier = pickCarrier(input.files, isSourcePath, input.seed);
    if (carrier === undefined) return null;
    if (alreadyContains(input.cleanDiff, /@ts-(ignore|expect-error|nocheck)\b/)) return null;
    const tag = tagOf(input, this.id);
    return {
      file: carrier,
      isNewFile: false,
      lines: [
        ctx(`export function widen_${tag}(value: string) {`),
        add(`  // @ts-expect-error suppressing the type error instead of fixing the call`),
        add(`  return parseRecord_${tag}(value).total.toFixed(2);`),
        ctx(`}`),
      ],
    };
  },
};
