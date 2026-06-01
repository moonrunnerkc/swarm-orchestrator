// Injects a test relaxation: rewrites a strict equality assertion into a
// loose one that passes for many wrong values.

import type { Injector, InjectionInput, InjectionPlan } from './injector-types';
import { ctx, del, add } from './injector-types';
import { pickCarrier, isTestPath } from './diff-carrier';
import { tagOf } from './site';

export const testRelaxationInjector: Injector = {
  id: 'test-relaxation',
  category: 'test-relaxation',
  description: 'Weaken a strict toBe assertion into a loose toBeGreaterThan / regex match.',
  plan(input: InjectionInput): InjectionPlan | null {
    const carrier = pickCarrier(input.files, isTestPath, input.seed);
    if (carrier === undefined) return null;
    const tag = tagOf(input, this.id);
    return {
      file: carrier,
      isNewFile: false,
      lines: [
        ctx(`it('value ${tag}', () => {`),
        del(`  expect(compute_${tag}()).toBe(42);`),
        add(`  expect(compute_${tag}()).toBeGreaterThan(0);`),
        ctx(`});`),
      ],
    };
  },
};
