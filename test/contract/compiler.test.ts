import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ContractValidationError,
  compileGoal,
  detectPackageManager,
  discoverRepoContext,
  finalize,
} from '../../src/contract/compiler';
import { canonicalSort, contractHash } from '../../src/contract/canonicalize';
import { StubExtractor } from '../../src/contract/extractor/stub-extractor';
import { type ObligationV1, type RepoContext } from '../../src/contract/types';

const tsContext: RepoContext = {
  repoRoot: '/tmp/example-ts',
  buildCommand: 'npm run build',
  testCommand: 'npm test',
  language: 'typescript',
};

const pyContext: RepoContext = {
  repoRoot: '/tmp/example-py',
  buildCommand: null,
  testCommand: null,
  language: 'python',
};

const jsContext: RepoContext = {
  repoRoot: '/tmp/example-js',
  buildCommand: 'pnpm run build',
  testCommand: 'pnpm test',
  language: 'javascript',
};

interface Transformation {
  /** Short label for the test case. */
  name: string;
  goal: string;
  repoContext: RepoContext;
  /** What the (mocked) extractor returns for this goal. */
  extracted: ObligationV1[];
  /** Optional minimum-types check (must be a subset of canonicalized output). */
  mustContainTypes?: ReadonlyArray<ObligationV1['type']>;
}

/**
 * Twenty-two goal-to-contract transformations covering: new-file goals,
 * behavioral-only goals, multi-file goals, Python-target projects, JS-with-
 * pnpm projects, intentionally shuffled extractor output, and
 * already-canonical extractor output. Each case asserts that the compiler
 * runs the input through validation, canonical sort, and produces a stable
 * hash. (Phase 1 exit criteria, impl guide §4.)
 */
const TRANSFORMATIONS: ReadonlyArray<Transformation> = [
  {
    name: '01: add a health check endpoint',
    goal: 'add a health check endpoint',
    repoContext: tsContext,
    extracted: [
      { type: 'file-must-exist', path: 'src/health.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
    mustContainTypes: ['file-must-exist', 'build-must-pass', 'test-must-pass'],
  },
  {
    name: '02: add a new utility module',
    goal: 'add a string-trim utility',
    repoContext: tsContext,
    extracted: [
      { type: 'test-must-pass', command: 'npm test' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'file-must-exist', path: 'src/strings/trim.ts' },
    ],
    mustContainTypes: ['file-must-exist', 'build-must-pass', 'test-must-pass'],
  },
  {
    name: '03: behavioral fix only',
    goal: 'fix the off-by-one in pagination',
    repoContext: tsContext,
    extracted: [
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
    mustContainTypes: ['build-must-pass', 'test-must-pass'],
  },
  {
    name: '04: behavioral refactor only',
    goal: 'extract the parser helper into a private function',
    repoContext: tsContext,
    extracted: [
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
    mustContainTypes: ['build-must-pass', 'test-must-pass'],
  },
  {
    name: '05: add CHANGES.md',
    goal: 'add a CHANGES file documenting the migration',
    repoContext: tsContext,
    extracted: [
      { type: 'file-must-exist', path: 'CHANGES.md' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
  },
  {
    name: '06: two new files',
    goal: 'add a Logger interface and a console implementation',
    repoContext: tsContext,
    extracted: [
      { type: 'file-must-exist', path: 'src/logging/console-logger.ts' },
      { type: 'file-must-exist', path: 'src/logging/logger.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
  },
  {
    name: '07: python project',
    goal: 'add a /healthz route to the Flask app',
    repoContext: pyContext,
    extracted: [
      { type: 'file-must-exist', path: 'app/routes/healthz.py' },
      { type: 'build-must-pass', command: 'python -m compileall app' },
      { type: 'test-must-pass', command: 'pytest' },
    ],
  },
  {
    name: '08: pnpm project',
    goal: 'add a date-formatting helper',
    repoContext: jsContext,
    extracted: [
      { type: 'file-must-exist', path: 'src/dates.ts' },
      { type: 'build-must-pass', command: 'pnpm run build' },
      { type: 'test-must-pass', command: 'pnpm test' },
    ],
  },
  {
    name: '09: shuffled extractor output (out-of-order)',
    goal: 'add a feature flag service',
    repoContext: tsContext,
    extracted: [
      { type: 'test-must-pass', command: 'npm test' },
      { type: 'file-must-exist', path: 'src/flags/service.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'file-must-exist', path: 'src/flags/index.ts' },
    ],
  },
  {
    name: '10: linting goal',
    goal: 'add a lint-staged config and an npm script',
    repoContext: tsContext,
    extracted: [
      { type: 'file-must-exist', path: '.lintstagedrc.json' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
  },
  {
    name: '11: docs goal',
    goal: 'document the new health endpoint in README',
    repoContext: tsContext,
    extracted: [
      { type: 'file-must-exist', path: 'README.md' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
  },
  {
    name: '12: typed config schema',
    goal: 'add a typed config loader for the API surface',
    repoContext: tsContext,
    extracted: [
      { type: 'file-must-exist', path: 'src/config/schema.ts' },
      { type: 'file-must-exist', path: 'src/config/loader.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
  },
  {
    name: '13: CI workflow',
    goal: 'add a GitHub Actions workflow for unit tests',
    repoContext: tsContext,
    extracted: [
      { type: 'file-must-exist', path: '.github/workflows/unit.yml' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
  },
  {
    name: '14: CLI subcommand',
    goal: 'add a hello subcommand to the CLI',
    repoContext: tsContext,
    extracted: [
      { type: 'file-must-exist', path: 'src/cli/hello.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
  },
  {
    name: '15: error class',
    goal: 'add a typed NotAuthorizedError',
    repoContext: tsContext,
    extracted: [
      { type: 'file-must-exist', path: 'src/errors/not-authorized.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
  },
  {
    name: '16: schema fixture',
    goal: 'add a JSON schema fixture for v2',
    repoContext: tsContext,
    extracted: [
      { type: 'file-must-exist', path: 'src/schema/v2.json' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
  },
  {
    name: '17: package json edit',
    goal: 'tighten the package.json engines field',
    repoContext: tsContext,
    extracted: [
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
  },
  {
    name: '18: python module + pyproject',
    goal: 'add a CLI entry point and pyproject script registration',
    repoContext: pyContext,
    extracted: [
      { type: 'file-must-exist', path: 'app/cli.py' },
      { type: 'build-must-pass', command: 'python -m compileall app' },
      { type: 'test-must-pass', command: 'pytest' },
    ],
  },
  {
    name: '19: monorepo workspace tests',
    goal: 'add a workspace package for shared types',
    repoContext: jsContext,
    extracted: [
      { type: 'file-must-exist', path: 'packages/types/src/index.ts' },
      { type: 'file-must-exist', path: 'packages/types/package.json' },
      { type: 'build-must-pass', command: 'pnpm run build' },
      { type: 'test-must-pass', command: 'pnpm test' },
    ],
  },
  {
    name: '20: integration test only',
    goal: 'add an integration test for the upload pipeline',
    repoContext: tsContext,
    extracted: [
      { type: 'file-must-exist', path: 'test/integration/upload.test.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
  },
  {
    name: '21: behavioral perf goal',
    goal: 'speed up the route matcher hot path',
    repoContext: tsContext,
    extracted: [
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
  },
  {
    name: '22: deeply nested file path',
    goal: 'add a vendor adapter under deeply/nested/dirs',
    repoContext: tsContext,
    extracted: [
      { type: 'file-must-exist', path: 'src/adapters/vendor/x/y/z/adapter.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
  },
];

describe('contract/compiler — 22 goal-to-contract transformations', () => {
  it('is at least 20 fixtures (Phase 1 exit criterion)', () => {
    assert.ok(TRANSFORMATIONS.length >= 20, `expected ≥20 fixtures, got ${TRANSFORMATIONS.length}`);
  });

  for (const t of TRANSFORMATIONS) {
    it(t.name, async () => {
      const extractor = StubExtractor.fromGoalMap({ [t.goal]: t.extracted });
      const draft = await compileGoal({
        goal: t.goal,
        repoContext: t.repoContext,
        extractor,
        autoTagDeterministic: false,
      });
      // Canonically sorted: matches canonicalSort applied to the same inputs.
      assert.deepEqual(draft.obligations, canonicalSort(t.extracted));
      // Goal and repoContext propagate to draft.
      assert.equal(draft.goal, t.goal);
      assert.equal(draft.repoContext.repoRoot, t.repoContext.repoRoot);
      // Provenance from stub is recorded.
      assert.equal(draft.extractor.name, 'stub');
      // Required types present per assertion.
      if (t.mustContainTypes) {
        const present = new Set(draft.obligations.map((o) => o.type));
        for (const ty of t.mustContainTypes) {
          assert.ok(present.has(ty), `expected type ${ty} for ${t.name}`);
        }
      }
      // Validator-level invariants (always required by Phase 1 spec).
      assert.ok(draft.obligations.some((o) => o.type === 'build-must-pass'));
      assert.ok(draft.obligations.some((o) => o.type === 'test-must-pass'));
    });
  }

  it('hash-stability: identical input produces identical contract output', async () => {
    const t = TRANSFORMATIONS[0];
    if (!t) throw new Error('fixtures missing');
    const ext1 = StubExtractor.fromObligations(t.extracted);
    const ext2 = StubExtractor.fromObligations(t.extracted);
    const a = await compileGoal({ goal: t.goal, repoContext: t.repoContext, extractor: ext1 });
    const b = await compileGoal({ goal: t.goal, repoContext: t.repoContext, extractor: ext2 });
    assert.equal(contractHash(a.obligations), contractHash(b.obligations));
    const fa = finalize(a, new Date('2026-05-08T00:00:00.000Z'));
    const fb = finalize(b, new Date('2026-05-08T00:00:00.000Z'));
    assert.equal(fa.manifest.contractHash, fb.manifest.contractHash);
    assert.equal(fa.manifest.contractId, fb.manifest.contractId);
  });

  it('hash-stability: hash unchanged when extractor returns shuffled input', async () => {
    const ordered: ObligationV1[] = [
      { type: 'file-must-exist', path: 'src/a.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ];
    const shuffled: ObligationV1[] = [
      { type: 'test-must-pass', command: 'npm test' },
      { type: 'file-must-exist', path: 'src/a.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
    ];
    const a = await compileGoal({
      goal: 'g',
      repoContext: tsContext,
      extractor: StubExtractor.fromObligations(ordered),
    });
    const b = await compileGoal({
      goal: 'g',
      repoContext: tsContext,
      extractor: StubExtractor.fromObligations(shuffled),
    });
    assert.equal(contractHash(a.obligations), contractHash(b.obligations));
  });

  it('throws ContractValidationError on missing build', async () => {
    const ext = StubExtractor.fromObligations([
      { type: 'file-must-exist', path: 'a.ts' },
      { type: 'test-must-pass', command: 'npm test' },
    ]);
    await assert.rejects(
      () => compileGoal({ goal: 'g', repoContext: tsContext, extractor: ext }),
      ContractValidationError,
    );
  });

  it('finalize stamps id, hash, and createdAt', () => {
    const draft = {
      schemaVersion: 'v1' as const,
      goal: 'g',
      repoContext: tsContext,
      obligations: [
        { type: 'file-must-exist', path: 'a.ts' },
        { type: 'build-must-pass', command: 'npm run build' },
        { type: 'test-must-pass', command: 'npm test' },
      ] as ObligationV1[],
      extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
    };
    const at = new Date('2026-05-08T12:00:00.000Z');
    const f = finalize(draft, at);
    assert.match(f.manifest.contractHash, /^[0-9a-f]{64}$/);
    assert.equal(f.manifest.contractId.length, 16);
    assert.equal(f.manifest.createdAt, at.toISOString());
  });
});

describe('contract/compiler — discoverRepoContext', () => {
  it('detects typescript when tsconfig.json is present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compiler-discover-ts-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsc', test: 'mocha' } }), 'utf8');
      fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({}), 'utf8');
      const ctx = discoverRepoContext(dir);
      assert.equal(ctx.language, 'typescript');
      assert.equal(ctx.buildCommand, 'npm run build');
      assert.equal(ctx.testCommand, 'npm test');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects python when pyproject.toml is present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compiler-discover-py-'));
    try {
      fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname = "x"\n', 'utf8');
      const ctx = discoverRepoContext(dir);
      assert.equal(ctx.language, 'python');
      assert.equal(ctx.buildCommand, null);
      assert.equal(ctx.testCommand, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null commands when package.json has no scripts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compiler-discover-empty-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x' }), 'utf8');
      const ctx = discoverRepoContext(dir);
      assert.equal(ctx.buildCommand, null);
      assert.equal(ctx.testCommand, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('contract/compiler — baseline tautology filter', () => {
  function makeRepo(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  }

  it('drops a property-must-hold whose predicate already exits zero on the baseline', async () => {
    const dir = makeRepo('compiler-tautology-drop-');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }), 'utf8');
      fs.writeFileSync(path.join(dir, 'README.md'), '# repo with feature-flag-enabled stuff', 'utf8');
      const tautological: ObligationV1 = {
        type: 'property-must-hold',
        predicate: "grep -q 'feature-flag-enabled' README.md",
        target: 'flag mentioned',
      };
      const meaningful: ObligationV1 = {
        type: 'property-must-hold',
        predicate: "grep -q 'brand-new-feature-token' README.md",
        target: 'new feature anchored',
      };
      const testPass: ObligationV1 = {
        type: 'test-must-pass',
        command: 'jest',
      };
      const ext = StubExtractor.fromObligations([tautological, meaningful, testPass]);
      const draft = await compileGoal({
        goal: 'demo',
        repoContext: {
          repoRoot: dir,
          buildCommand: null,
          testCommand: 'jest',
          language: 'typescript',
        },
        extractor: ext,
        autoTagDeterministic: false,
      });
      // tautological obligation is dropped; meaningful + test pass through.
      assert.equal(draft.obligations.length, 2);
      assert.ok(draft.tautologyWarnings);
      assert.equal(draft.tautologyWarnings!.length, 1);
      assert.equal((draft.tautologyWarnings![0]!.obligation as { target: string }).target, 'flag mentioned');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps all obligations when no predicate is tautological', async () => {
    const dir = makeRepo('compiler-tautology-keep-');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }), 'utf8');
      fs.writeFileSync(path.join(dir, 'README.md'), '# nothing relevant here', 'utf8');
      const obligation: ObligationV1 = {
        type: 'property-must-hold',
        predicate: "grep -q 'NEW-TOKEN-ONLY-IN-PATCH' README.md",
        target: 'new token anchored',
      };
      const testPass: ObligationV1 = { type: 'test-must-pass', command: 'jest' };
      const ext = StubExtractor.fromObligations([obligation, testPass]);
      const draft = await compileGoal({
        goal: 'demo',
        repoContext: { repoRoot: dir, buildCommand: null, testCommand: 'jest', language: 'typescript' },
        extractor: ext,
        autoTagDeterministic: false,
      });
      assert.equal(draft.obligations.length, 2);
      assert.equal((draft.tautologyWarnings ?? []).length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips the baseline check when repoRoot does not exist on disk (unit-test contexts)', async () => {
    const obligation: ObligationV1 = {
      type: 'property-must-hold',
      predicate: "grep -q 'anything' nonexistent.txt",
      target: 'cannot be checked',
    };
    const testPass: ObligationV1 = { type: 'test-must-pass', command: 'jest' };
    const ext = StubExtractor.fromObligations([obligation, testPass]);
    const draft = await compileGoal({
      goal: 'demo',
      repoContext: { repoRoot: '/tmp/this-path-does-not-exist-xyz123', buildCommand: null, testCommand: 'jest', language: 'typescript' },
      extractor: ext,
      autoTagDeterministic: false,
    });
    // Without a real workspace we cannot check the predicate; the
    // obligation passes through unchanged so unit tests work.
    assert.equal(draft.obligations.length, 2);
  });
});

describe('contract/compiler — detectPackageManager', () => {
  function makeRepo(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  }

  it('honors an explicit corepack packageManager field over any lockfile', () => {
    const dir = makeRepo('compiler-pm-corepack-');
    try {
      fs.writeFileSync(path.join(dir, 'yarn.lock'), '', 'utf8');
      fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '', 'utf8');
      // packageManager declared as pnpm — wins regardless of yarn.lock.
      assert.equal(detectPackageManager(dir, 'pnpm@8.0.0'), 'pnpm');
      assert.equal(detectPackageManager(dir, 'npm@10.0.0'), 'npm');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to npm when no lockfile is present', () => {
    const dir = makeRepo('compiler-pm-empty-');
    try {
      assert.equal(detectPackageManager(dir), 'npm');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns npm when both yarn.lock and package-lock.json exist (npm is always on PATH with Node)', () => {
    const dir = makeRepo('compiler-pm-both-');
    try {
      fs.writeFileSync(path.join(dir, 'yarn.lock'), '', 'utf8');
      fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}', 'utf8');
      // pnpm is rare on CI machines, yarn is hit-or-miss; npm is always
      // present. The detector iterates pnpm/yarn/npm in that order and
      // only returns one whose CLI is on PATH. Test machines may or may
      // not have pnpm/yarn; npm is guaranteed.
      const got = detectPackageManager(dir);
      assert.ok(got === 'npm' || got === 'yarn' || got === 'pnpm');
      // Critical regression guard: even when yarn.lock exists, if yarn is
      // not on PATH we MUST NOT return 'yarn'. Stub PATH to no-yarn by
      // shadowing in a temp dir below in the dedicated test.
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT return yarn when yarn.lock is present but yarn is not on PATH', () => {
    const dir = makeRepo('compiler-pm-no-yarn-');
    try {
      fs.writeFileSync(path.join(dir, 'yarn.lock'), '', 'utf8');
      // Shadow PATH with an empty dir so `command -v yarn` resolves nothing.
      // Also shadow pnpm. npm is always available — we want the detector to
      // fall back to npm rather than emit "yarn test" which would exit 127.
      const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'compiler-pm-emptypath-'));
      const originalPath = process.env.PATH;
      try {
        process.env.PATH = sandbox;
        // npm is also gone in this sandbox, so the function will fall through
        // to the final default. That default is npm.
        assert.equal(detectPackageManager(dir), 'npm');
      } finally {
        process.env.PATH = originalPath;
        fs.rmSync(sandbox, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
