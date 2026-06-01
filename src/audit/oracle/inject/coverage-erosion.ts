// Injects coverage erosion: adds a new conditional branch to production
// code without adding any test that exercises it.

import type { Injector, InjectionInput, InjectionPlan } from './injector-types';
import { ctx, add } from './injector-types';
import { pickCarrier, isSourcePath } from './diff-carrier';
import { tagOf } from './site';

export const coverageErosionInjector: Injector = {
  id: 'coverage-erosion',
  category: 'coverage-erosion',
  description: 'Add an untested conditional branch to a source function.',
  plan(input: InjectionInput): InjectionPlan | null {
    const carrier = pickCarrier(input.files, isSourcePath, input.seed);
    if (carrier === undefined) return null;
    const tag = tagOf(input, this.id);
    // Whole-PR detector: it fires only when a source branch is added with
    // no test-signal addition anywhere in the diff, so the defect is
    // emitted as a standalone diff that touches only the source file.
    return {
      file: carrier,
      isNewFile: false,
      isolated: true,
      lines: [
        ctx(`export function clamp_${tag}(x: number): number {`),
        add(`  if (x < 0) {`),
        add(`    return 0;`),
        add(`  }`),
        ctx(`  return x;`),
        ctx(`}`),
      ],
    };
  },
};
