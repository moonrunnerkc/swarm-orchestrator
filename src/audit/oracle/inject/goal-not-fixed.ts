// Semantic injector. Adds a real, plausible-looking code change that does
// NOT address the fix the PR claims. There is no structural tell: the
// added lines are ordinary code, not an empty catch or a stripped
// assertion. Only a judge that reads the claim against the code can see
// the claimed condition is still unhandled. The claim is carried in the
// label and presented to the judge as the PR's intent.

import type { Injector, InjectionInput, InjectionPlan } from './injector-types';
import { add } from './injector-types';
import { pickDirectory, isSourcePath } from './diff-carrier';
import { tagOf } from './site';

export const goalNotFixedInjector: Injector = {
  id: 'goal-not-fixed',
  category: 'goal-not-fixed',
  description:
    'Add ordinary-looking code that does not handle the condition the PR claims to fix.',
  plan(input: InjectionInput): InjectionPlan | null {
    const dir = pickDirectory(input.files, isSourcePath, input.seed);
    if (dir === undefined) return null;
    const tag = tagOf(input, this.id);
    const path = `${dir ? `${dir}/` : ''}injected_goal_${tag}.ts`;
    // The function still indexes [0] with no empty-input guard, so the
    // claimed crash-on-empty-input is not fixed. Nothing structural fires.
    return {
      file: path,
      isNewFile: true,
      claim: `Fix first_${tag}: return a safe default instead of crashing on empty input`,
      lines: [
        add(`export function first_${tag}<T>(items: readonly T[]): T {`),
        add(`  const head = items[0];`),
        add(`  return head;`),
        add(`}`),
      ],
    };
  },
};
