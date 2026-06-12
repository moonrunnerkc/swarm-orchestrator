import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTypeSuppressionRestoration } from '../../../src/audit/execution-grounded/type-suppression-restoration';

// End-to-end demonstration of the type-suppression-proven proof against a real
// git checkout and a real `tsc`, gated behind SWARM_EG_INTEGRATION so the
// default `npm test` stays offline and deterministic. It builds two synthetic
// PRs: one that adds a `@ts-ignore` over a real type error (proven) and one that
// adds a `@ts-ignore` over a line with no error (refuted), and confirms the
// proven case's published reproduce path actually surfaces the diagnostic in a
// fresh checkout.
const INTEGRATION = process.env.SWARM_EG_INTEGRATION === '1';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      moduleResolution: 'node',
      module: 'commonjs',
      target: 'ES2022',
    },
    include: ['src'],
  },
  null,
  2,
);

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
}

function scaffold(dir: string, calcSource: string): void {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'tsup-demo', version: '1.0.0', private: true }, null, 2),
  );
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), TSCONFIG);
  fs.writeFileSync(path.join(dir, 'src', 'calc.ts'), calcSource);
}

function commitAll(dir: string, message: string): string {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message]);
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
}

function initRepo(dir: string): void {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'demo@example.com']);
  git(dir, ['config', 'user.name', 'demo']);
}

const CLEAN = 'export function add(a: number, b: number): number {\n  return a + b;\n}\n';

(INTEGRATION ? describe : describe.skip)('type-suppression-proven e2e (live tsc)', function () {
  this.timeout(240_000);

  it('proves a suppression that hid a real type error and the reproduce path surfaces it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-tsupproof-'));
    try {
      scaffold(dir, CLEAN);
      initRepo(dir);
      commitAll(dir, 'base: clean add');

      // The PR introduces a call to an undefined name, hidden behind @ts-ignore.
      fs.writeFileSync(
        path.join(dir, 'src', 'calc.ts'),
        'export function add(a: number, b: number): number {\n' +
          '  // @ts-ignore\n' +
          '  return a + b + missing();\n' +
          '}\n',
      );
      const headSha = commitAll(dir, 'feat: extend add');
      const prDiff = spawnSync('git', ['diff', 'HEAD~1', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout;

      const record = runTypeSuppressionRestoration({
        finding: { category: 'type-suppression', file: 'src/calc.ts' },
        prDiff,
        prRef: 'acme/calc#1',
        prHeadSha: headSha,
        postWorkspacePath: dir,
        repoRoot: dir,
        timeoutMs: 180_000,
      });

      assert.equal(record.verdict, 'proven', `expected proven, got ${record.verdict}: ${record.reason ?? ''}`);
      assert.equal(record.controls.directiveRemoved, true);
      assert.equal(record.controls.fileCleanAsSubmitted, true);
      assert.equal(record.controls.diagnosticSurfacesWhenRemoved, true);
      assert.deepEqual(record.removedDirectives, ['@ts-ignore']);
      assert.ok(record.surfacedDiagnostics.length > 0, 'a diagnostic must be attached');
      assert.match(record.surfacedDiagnostics.join('\n'), /missing/);

      // Reproduce in a FRESH checkout: removing the directive must surface the
      // diagnostic (tsc exits non-zero).
      const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-tsupproof-fresh-'));
      try {
        git(fresh, ['clone', '-q', dir, '.']);
        fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(fresh, 'node_modules'));
        git(fresh, ['checkout', '-q', headSha]);
        const apply = spawnSync('git', ['apply', '-R', '--whitespace=nowarn', '-'], {
          cwd: fresh,
          input: record.revertedHunkPatch,
          encoding: 'utf8',
        });
        assert.equal(apply.status, 0, `reverse-apply failed: ${apply.stderr}`);
        const tsc = spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'], {
          cwd: fresh,
          encoding: 'utf8',
          env: { ...process.env, CI: 'true' },
        });
        assert.notEqual(tsc.status, 0, 'tsc must report the diagnostic once the directive is gone');
        assert.match(`${tsc.stdout}\n${tsc.stderr}`, /missing/);
      } finally {
        fs.rmSync(fresh, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refutes a suppression that silenced nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-tsupproof-refute-'));
    try {
      scaffold(dir, CLEAN);
      initRepo(dir);
      commitAll(dir, 'base: clean add');

      // The PR adds a @ts-ignore over a line that has no type error.
      fs.writeFileSync(
        path.join(dir, 'src', 'calc.ts'),
        'export function add(a: number, b: number): number {\n' +
          '  // @ts-ignore\n' +
          '  return a + b;\n' +
          '}\n',
      );
      const headSha = commitAll(dir, 'chore: add a needless suppression');
      const prDiff = spawnSync('git', ['diff', 'HEAD~1', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout;

      const record = runTypeSuppressionRestoration({
        finding: { category: 'type-suppression', file: 'src/calc.ts' },
        prDiff,
        prRef: 'acme/calc#1',
        prHeadSha: headSha,
        postWorkspacePath: dir,
        repoRoot: dir,
        timeoutMs: 180_000,
      });

      assert.equal(record.verdict, 'refuted', `expected refuted, got ${record.verdict}: ${record.reason ?? ''}`);
      assert.equal(record.controls.fileCleanAsSubmitted, true);
      assert.equal(record.controls.diagnosticSurfacesWhenRemoved, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
