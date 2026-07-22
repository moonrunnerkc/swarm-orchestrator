// Honest (negative) injector for the builtin-module exemption in the
// mock-of-hallucination detector. It splices mocks of Node builtins in
// the three specifier shapes the exemption normalizes (node:-prefixed,
// bare, and subpath) into a real test carrier. The code is legitimate:
// builtins ship with the runtime and no manifest declares them, so the
// detector must emit nothing. The oracle scorer counts any
// mock-of-hallucination finding on this case as a false positive.

import type { Injector, InjectionInput, InjectionPlan } from './injector-types';
import { add } from './injector-types';
import { pickCarrier, pickDirectory, isTestPath } from './diff-carrier';
import { tagOf } from './site';

const BUILTIN_MOCK_LINES = [
  add(`vi.mock('node:child_process');`),
  add(`jest.mock('fs');`),
  add(`jest.mock('node:fs/promises');`),
];

export const builtinMockHonestInjector: Injector = {
  id: 'builtin-mock-honest',
  category: 'mock-of-hallucination',
  description:
    'Honest case: mock Node builtins (node:child_process, fs, node:fs/promises); the detector must stay silent.',
  honest: true,
  plan(input: InjectionInput): InjectionPlan | null {
    // JS/TS test carriers only: jest/vitest mock lines in a Python or Go
    // test file would be an incoherent case.
    const isJsTestPath = (p: string): boolean => isTestPath(p) && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p);
    const carrier = pickCarrier(input.files, isJsTestPath, input.seed);
    if (carrier !== undefined) {
      return {
        file: carrier,
        isNewFile: false,
        lines: BUILTIN_MOCK_LINES,
      };
    }
    // No real test carrier: drop a new test file next to a source file.
    const dir = pickDirectory(input.files, (p) => /\.(ts|js)$/.test(p), input.seed);
    if (dir === undefined) return null;
    const tag = tagOf(input, this.id);
    const path = `${dir ? `${dir}/` : ''}builtin_mock_${tag}.test.ts`;
    return {
      file: path,
      isNewFile: true,
      lines: [
        ...BUILTIN_MOCK_LINES,
        add(`it('spawns via the child_process builtin', () => {`),
        add(`  expect(true).toBe(true);`),
        add(`});`),
      ],
    };
  },
};
