// Injects a no-op fix: the PR edits a source function and a test in the
// same change, but the test it touches exercises a different identifier
// than the source it touches, so the test cannot be covering the code the
// PR claims to fix. The detector keys on that source/test symbol mismatch,
// which needs both sides present in one diff, so this is emitted as a
// standalone two-file diff rather than appended to a carrier.

import type { Injector, InjectionInput, InjectionPlan } from './injector-types';
import { ctx, del, add } from './injector-types';
import { pickCarrier, isTestPath, isSourcePath } from './diff-carrier';
import { tagOf } from './site';

export const noOpFixInjector: Injector = {
  id: 'no-op-fix',
  category: 'no-op-fix',
  description: 'Edit a source function and an unrelated test so the test cannot cover the fix.',
  plan(input: InjectionInput): InjectionPlan | null {
    const sourceCarrier = pickCarrier(input.files, isSourcePath, input.seed);
    const testCarrier = pickCarrier(input.files, isTestPath, input.seed);
    if (sourceCarrier === undefined || testCarrier === undefined) return null;
    const tag = tagOf(input, this.id);
    return {
      file: sourceCarrier,
      isNewFile: false,
      isolated: true,
      // Source side touches `feature_<tag>`; the test side touches
      // `helper_<tag>`. No shared identifier, so the test changes cannot
      // exercise the source changes.
      lines: [
        ctx(`export function feature_${tag}(x: number): number {`),
        del(`  return x;`),
        add(`  return x; // adjusted, but the reported bug path is untouched`),
        ctx(`}`),
      ],
      secondFile: {
        file: testCarrier,
        lines: [
          ctx(`it('helper ${tag}', () => {`),
          del(`  expect(helper_${tag}()).toBe(1);`),
          add(`  expect(helper_${tag}()).toBe(2);`),
          ctx(`});`),
        ],
      },
    };
  },
};
