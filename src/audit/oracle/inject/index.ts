// Injector registry. Adding a category is one import plus one array
// entry, mirroring the cheat-detector registry. The order is fixed so the
// runner produces deterministic output.

import type { Injector } from './injector-types';
import { errorSwallowInjector } from './error-swallow';
import { mockOfHallucinationInjector } from './mock-of-hallucination';
import { assertionStripInjector } from './assertion-strip';
import { testRelaxationInjector } from './test-relaxation';
import { noOpFixInjector } from './no-op-fix';
import { coverageErosionInjector } from './coverage-erosion';
import { fakeRefactorInjector } from './fake-refactor';
import { commentOnlyFixInjector } from './comment-only-fix';
import { exceptionRethrowLostContextInjector } from './exception-rethrow-lost-context';
import { deadBranchInsertionInjector } from './dead-branch-insertion';
import { typeSuppressionInjector } from './type-suppression';
import { goalNotFixedInjector } from './goal-not-fixed';
import { cheatMockMutationInjector } from './cheat-mock-mutation';

export const INJECTORS: readonly Injector[] = [
  // Structural: a detector keys on the shape today.
  testRelaxationInjector,
  mockOfHallucinationInjector,
  assertionStripInjector,
  noOpFixInjector,
  coverageErosionInjector,
  fakeRefactorInjector,
  commentOnlyFixInjector,
  errorSwallowInjector,
  exceptionRethrowLostContextInjector,
  deadBranchInsertionInjector,
  typeSuppressionInjector,
  // Semantic: structurally invisible, the judge is the only detector.
  goalNotFixedInjector,
  cheatMockMutationInjector,
];

export function injectorById(id: string): Injector | undefined {
  return INJECTORS.find((i) => i.id === id);
}

export type { Injector, InjectionInput, InjectionPlan, InjectionLabel, OracleCategory } from './injector-types';
export { renderPlan } from './diff-carrier';
