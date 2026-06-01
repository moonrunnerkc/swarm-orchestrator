// Injects a mock of a module that does not exist: jest.mock against an
// invented vendor package, so the test green-lights against a stub of
// nothing real.

import type { Injector, InjectionInput, InjectionPlan } from './injector-types';
import { add } from './injector-types';
import { pickCarrier, pickDirectory, isTestPath, alreadyContains } from './diff-carrier';
import { tagOf } from './site';

export const mockOfHallucinationInjector: Injector = {
  id: 'mock-of-hallucination',
  category: 'mock-of-hallucination',
  description: 'jest.mock an invented vendor package that is not a declared dependency.',
  plan(input: InjectionInput): InjectionPlan | null {
    const tag = tagOf(input, this.id);
    const fake = `imaginary-vendor-sdk-${tag}`;
    if (alreadyContains(input.cleanDiff, new RegExp(`jest\\.mock\\(['"]${fake}`))) return null;
    const carrier = pickCarrier(input.files, isTestPath, input.seed);
    if (carrier !== undefined) {
      return {
        file: carrier,
        isNewFile: false,
        lines: [add(`jest.mock('${fake}');`)],
      };
    }
    // No real test carrier: drop a new test file next to a source file.
    const dir = pickDirectory(input.files, (p) => /\.(ts|js)$/.test(p), input.seed);
    if (dir === undefined) return null;
    const path = `${dir ? `${dir}/` : ''}injected_mock_${tag}.test.ts`;
    return {
      file: path,
      isNewFile: true,
      lines: [
        add(`jest.mock('${fake}');`),
        add(`it('uses ${fake}', () => {`),
        add(`  expect(true).toBe(true);`),
        add(`});`),
      ],
    };
  },
};
