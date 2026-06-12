import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runFakeRefactorRestoration } from '../../../src/audit/execution-grounded/fake-refactor-restoration';

// End-to-end demonstration of the fake-refactor-proven proof against a real git
// checkout, gated behind SWARM_EG_INTEGRATION so the default `npm test` stays
// offline. It builds a PR that renames an exported symbol but leaves a caller on
// the old name (proven) and one whose rename is complete (refuted), then replays
// the proven case's published grep reproduce command in a fresh checkout to
// confirm it actually lists the surviving reference.
const INTEGRATION = process.env.SWARM_EG_INTEGRATION === '1';

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
}

function initRepo(dir: string): void {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'demo@example.com']);
  git(dir, ['config', 'user.name', 'demo']);
}

function commitAll(dir: string, message: string): string {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message]);
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
}

const BASE_CALC = 'export function oldTotal(a: number, b: number): number {\n  return a + b;\n}\n';
const REPORT = "import { oldTotal } from './calc';\nexport const r = oldTotal(1, 2);\n";

(INTEGRATION ? describe : describe.skip)('fake-refactor-proven e2e (real checkout)', function () {
  this.timeout(120_000);

  it('proves an incomplete rename and the grep reproduce path lists the surviving reference', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-fakerefproof-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'calc.ts'), BASE_CALC);
      fs.writeFileSync(path.join(dir, 'src', 'report.ts'), REPORT);
      initRepo(dir);
      commitAll(dir, 'base: oldTotal and its caller');

      // The "refactor": rename the export but DO NOT update the caller.
      fs.writeFileSync(
        path.join(dir, 'src', 'calc.ts'),
        'export function computeTotal(a: number, b: number): number {\n  return a + b;\n}\n',
      );
      const headSha = commitAll(dir, 'refactor: rename oldTotal -> computeTotal');
      const prDiff = spawnSync('git', ['diff', 'HEAD~1', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout;

      const record = runFakeRefactorRestoration({
        finding: { category: 'fake-refactor', file: 'src/calc.ts', line: 1 },
        prDiff,
        prRef: 'acme/calc#1',
        prHeadSha: headSha,
        repoRoot: dir,
      });

      assert.equal(record.verdict, 'proven', `expected proven, got ${record.verdict}: ${record.reason ?? ''}`);
      assert.equal(record.controls.oldSymbolResolved, true);
      assert.equal(record.controls.oldSymbolDeclarationRemoved, true);
      assert.equal(record.controls.oldSymbolStillReferenced, true);
      assert.ok(record.references.some((r) => r.startsWith('src/report.ts:')));

      // Replay the grep reproduce path in a fresh checkout: it must list the
      // surviving reference.
      const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-fakerefproof-fresh-'));
      try {
        git(fresh, ['clone', '-q', dir, '.']);
        git(fresh, ['checkout', '-q', headSha]);
        const grep = spawnSync('grep', ['-rnw', 'oldTotal', 'src/report.ts'], {
          cwd: fresh,
          encoding: 'utf8',
        });
        assert.equal(grep.status, 0, 'grep must find the surviving reference');
        assert.match(grep.stdout, /oldTotal/);
      } finally {
        fs.rmSync(fresh, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refutes a complete rename', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-fakerefproof-refute-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'calc.ts'), BASE_CALC);
      fs.writeFileSync(path.join(dir, 'src', 'report.ts'), REPORT);
      initRepo(dir);
      commitAll(dir, 'base: oldTotal and its caller');

      // The complete refactor: rename the export AND update the caller.
      fs.writeFileSync(
        path.join(dir, 'src', 'calc.ts'),
        'export function computeTotal(a: number, b: number): number {\n  return a + b;\n}\n',
      );
      fs.writeFileSync(
        path.join(dir, 'src', 'report.ts'),
        "import { computeTotal } from './calc';\nexport const r = computeTotal(1, 2);\n",
      );
      const headSha = commitAll(dir, 'refactor: rename oldTotal -> computeTotal (complete)');
      const prDiff = spawnSync('git', ['diff', 'HEAD~1', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout;

      const record = runFakeRefactorRestoration({
        finding: { category: 'fake-refactor', file: 'src/calc.ts', line: 1 },
        prDiff,
        prRef: 'acme/calc#1',
        prHeadSha: headSha,
        repoRoot: dir,
      });

      assert.equal(record.verdict, 'refuted', `expected refuted, got ${record.verdict}: ${record.reason ?? ''}`);
      assert.equal(record.controls.oldSymbolStillReferenced, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
