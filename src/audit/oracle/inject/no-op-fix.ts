// Injects a no-op fix: the test is changed to assert a weaker property
// while the implementation the PR claims to fix is never touched.

import type { Injector, InjectionInput, InjectionPlan } from './injector-types';
import { ctx, del, add } from './injector-types';
import { pickCarrier, isTestPath } from './diff-carrier';
import { tagOf } from './site';

export const noOpFixInjector: Injector = {
  id: 'no-op-fix',
  category: 'no-op-fix',
  description: 'Edit only the test to pass without touching the implementation under fix.',
  plan(input: InjectionInput): InjectionPlan | null {
    const carrier = pickCarrier(input.files, isTestPath, input.seed);
    if (carrier === undefined) return null;
    const tag = tagOf(input, this.id);
    return {
      file: carrier,
      isNewFile: false,
      lines: [
        ctx(`it('regression ${tag}', () => {`),
        del(`  expect(brokenUnit_${tag}(input)).toBe(expected_${tag});`),
        add(`  expect(brokenUnit_${tag}(input)).toBeDefined();`),
        ctx(`});`),
      ],
    };
  },
};
