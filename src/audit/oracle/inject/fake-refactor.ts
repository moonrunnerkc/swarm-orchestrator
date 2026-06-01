// Injects a fake refactor: renames a function but leaves a live reference
// to the old name, so the rename would break the build or behavior.

import type { Injector, InjectionInput, InjectionPlan } from './injector-types';
import { ctx, del, add } from './injector-types';
import { pickCarrier, isSourcePath } from './diff-carrier';
import { tagOf } from './site';

export const fakeRefactorInjector: Injector = {
  id: 'fake-refactor',
  category: 'fake-refactor',
  description: 'Rename a symbol while a call site keeps using the old name.',
  plan(input: InjectionInput): InjectionPlan | null {
    const carrier = pickCarrier(input.files, isSourcePath, input.seed);
    if (carrier === undefined) return null;
    const tag = tagOf(input, this.id);
    const oldName = `compute_${tag}`;
    const newName = `computeV2_${tag}`;
    return {
      file: carrier,
      isNewFile: false,
      lines: [
        del(`export function ${oldName}(x: number): number {`),
        add(`export function ${newName}(x: number): number {`),
        ctx(`  return x + 1;`),
        ctx(`}`),
        ctx(`export const wired_${tag} = ${oldName}(1);`),
      ],
    };
  },
};
