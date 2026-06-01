// Small shared helpers for injectors: a stable per-injection tag derived
// from the source PR so generated identifiers are deterministic and
// unique across injectors, and the standard carrier predicates.

import type { InjectionInput } from './injector-types';

export function tagOf(input: InjectionInput, injectorId: string): string {
  const base = `${input.prId}-${injectorId}-${input.seed}`;
  return base.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}
