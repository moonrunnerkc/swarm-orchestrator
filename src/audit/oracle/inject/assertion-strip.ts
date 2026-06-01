// Injects an assertion strip: removes expect() calls from a test body
// without replacing them, weakening a test that still nominally exists.

import type { Injector, InjectionInput, InjectionPlan } from './injector-types';
import { ctx, del } from './injector-types';
import { pickCarrier, isTestPath } from './diff-carrier';
import { tagOf } from './site';

export const assertionStripInjector: Injector = {
  id: 'assertion-strip',
  category: 'assertion-strip',
  description: 'Delete expect() assertions from a test without replacing them.',
  plan(input: InjectionInput): InjectionPlan | null {
    // Removing assertions needs a real test carrier: a new file cannot
    // carry deletions.
    const carrier = pickCarrier(input.files, isTestPath, input.seed);
    if (carrier === undefined) return null;
    const tag = tagOf(input, this.id);
    return {
      file: carrier,
      isNewFile: false,
      lines: [
        ctx(`it('checks ${tag}', () => {`),
        del(`  expect(result_${tag}.a).toBe(1);`),
        del(`  expect(result_${tag}.b).toBe(2);`),
        del(`  expect(result_${tag}.c).toBe(3);`),
        ctx(`});`),
      ],
    };
  },
};
