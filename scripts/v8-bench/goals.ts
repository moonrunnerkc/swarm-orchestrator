import type { ObligationV1 } from '../../src/contract/types';

/**
 * Bench goal size class. Per impl guide §5: small ≤ 3, medium 4-8,
 * large > 8. Phase 2 ships 5 small + 3 medium + 2 large = 10 goals.
 */
export type BenchSize = 'small' | 'medium' | 'large';

export interface BenchGoal {
  id: string;
  size: BenchSize;
  goal: string;
  /**
   * The exact obligation list the bench injects via stub extractor. Phase 2
   * benchmarks the substrate cost, not the contract compiler accuracy, so we
   * pre-state the obligations here and use a `fromObligations` extractor.
   */
  obligations: ObligationV1[];
}

/**
 * The Phase 2 benchmark suite: 5 small + 3 medium + 2 large goals. Each
 * goal's obligation list is hand-written so the suite is deterministic.
 */
export const BENCH_GOALS: BenchGoal[] = [
  // ── small (≤ 3 obligations) ───────────────────────────────────────────
  {
    id: 'small-changes',
    size: 'small',
    goal: 'add a CHANGES.md note',
    obligations: [
      { type: 'file-must-exist', path: 'CHANGES.md' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ],
  },
  {
    id: 'small-readme',
    size: 'small',
    goal: 'add a project README',
    obligations: [
      { type: 'file-must-exist', path: 'README.md' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ],
  },
  {
    id: 'small-license',
    size: 'small',
    goal: 'add an MIT LICENSE file',
    obligations: [
      { type: 'file-must-exist', path: 'LICENSE' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ],
  },
  {
    id: 'small-gitignore',
    size: 'small',
    goal: 'add a .gitignore file',
    obligations: [
      { type: 'file-must-exist', path: '.gitignore' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ],
  },
  {
    id: 'small-editorconfig',
    size: 'small',
    goal: 'add an .editorconfig file',
    obligations: [
      { type: 'file-must-exist', path: '.editorconfig' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ],
  },
  // ── medium (4-8 obligations) ──────────────────────────────────────────
  {
    id: 'medium-health-endpoint',
    size: 'medium',
    goal: 'add a health-check endpoint module',
    obligations: [
      { type: 'file-must-exist', path: 'src/health.ts' },
      { type: 'file-must-exist', path: 'src/index.ts' },
      { type: 'file-must-exist', path: 'docs/health.md' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ],
  },
  {
    id: 'medium-cli-tooling',
    size: 'medium',
    goal: 'add a CLI tooling module with help and version subcommands',
    obligations: [
      { type: 'file-must-exist', path: 'src/cli/index.ts' },
      { type: 'file-must-exist', path: 'src/cli/help.ts' },
      { type: 'file-must-exist', path: 'src/cli/version.ts' },
      { type: 'file-must-exist', path: 'src/cli/types.ts' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ],
  },
  {
    id: 'medium-config-loader',
    size: 'medium',
    goal: 'add a config loader with schema and defaults',
    obligations: [
      { type: 'file-must-exist', path: 'src/config/loader.ts' },
      { type: 'file-must-exist', path: 'src/config/schema.ts' },
      { type: 'file-must-exist', path: 'src/config/defaults.ts' },
      { type: 'file-must-exist', path: 'src/config/index.ts' },
      { type: 'file-must-exist', path: 'src/config/types.ts' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ],
  },
  // ── large (> 8 obligations) ───────────────────────────────────────────
  {
    id: 'large-feature-suite',
    size: 'large',
    goal: 'add a small feature with handler, types, schema, error codes, and docs',
    obligations: [
      { type: 'file-must-exist', path: 'src/feature/handler.ts' },
      { type: 'file-must-exist', path: 'src/feature/types.ts' },
      { type: 'file-must-exist', path: 'src/feature/schema.ts' },
      { type: 'file-must-exist', path: 'src/feature/errors.ts' },
      { type: 'file-must-exist', path: 'src/feature/index.ts' },
      { type: 'file-must-exist', path: 'src/feature/util.ts' },
      { type: 'file-must-exist', path: 'docs/feature-guide.md' },
      { type: 'file-must-exist', path: 'docs/feature-api.md' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ],
  },
  {
    id: 'large-multi-module',
    size: 'large',
    goal: 'add a multi-module package skeleton',
    obligations: [
      { type: 'file-must-exist', path: 'src/core/index.ts' },
      { type: 'file-must-exist', path: 'src/core/types.ts' },
      { type: 'file-must-exist', path: 'src/io/reader.ts' },
      { type: 'file-must-exist', path: 'src/io/writer.ts' },
      { type: 'file-must-exist', path: 'src/io/index.ts' },
      { type: 'file-must-exist', path: 'src/util/format.ts' },
      { type: 'file-must-exist', path: 'src/util/parse.ts' },
      { type: 'file-must-exist', path: 'src/util/index.ts' },
      { type: 'file-must-exist', path: 'src/index.ts' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ],
  },
];

/**
 * Sanity check on the suite. Throws when the per-size counts don't match
 * impl guide §5. Used by the benchmark harness and a unit test.
 */
export function assertSuiteShape(): void {
  const counts: Record<BenchSize, number> = { small: 0, medium: 0, large: 0 };
  for (const g of BENCH_GOALS) counts[g.size] += 1;
  if (counts.small !== 5 || counts.medium !== 3 || counts.large !== 2) {
    throw new Error(
      `bench suite must be 5+3+2 (impl guide §5); got ${JSON.stringify(counts)}`,
    );
  }
}
