import { strict as assert } from 'assert';
import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TASKS_DIR = path.join(REPO_ROOT, 'benchmarks', 'constraint-binding', 'tasks');
const FIXTURES_DIR = path.join(REPO_ROOT, 'benchmarks', 'constraint-binding', 'fixtures');
const ENGINE = path.join(REPO_ROOT, 'benchmarks', 'constraint-binding', 'validator-engine.js');

const engine: {
  loadTask: (p: string) => {
    id: string;
    pattern: string;
    pre_state: { fixture_tarball: string; fixture_sha256: string };
    post_state_validators: Array<{ name: string; cmd: string }>;
  };
  runValidators: (
    t: unknown,
    workdir: string,
    opts?: { timeoutMs?: number },
  ) => {
    passed: boolean;
    validators: Array<{ name: string; passed: boolean; exitCode: number; timedOut: boolean }>;
  };
} = require(ENGINE);

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function fixturesPresent(): boolean {
  if (!fs.existsSync(FIXTURES_DIR)) return false;
  const entries = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.tar.gz'));
  return entries.length === 4;
}

describe('Constraint-binding pipeline smoke', function () {
  // Fixture extraction + validator execution takes a few seconds each
  this.timeout(60_000);

  before(function skipWithoutFixtures() {
    if (!fixturesPresent()) {
      console.warn(
        '\n  Fixtures not present. Run `bash scripts/fetch-fixtures.sh` and re-run tests.\n',
      );
      this.skip();
    }
  });

  it('every pilot fixture extracts and every validator is rejected on the un-modified baseline', () => {
    // This is the core smoke: if the validator passes the UN-MODIFIED fixture,
    // it has no teeth — it would also pass a broken agent output. The correct
    // behavior is that each task's validators fail until the prompted change
    // is applied. One task failing a validator on the baseline proves the
    // validator actually gates correctness.
    const taskFiles = fs
      .readdirSync(TASKS_DIR)
      .filter((f) => f.endsWith('.yaml'))
      .sort();
    assert.strictEqual(taskFiles.length, 4, 'expected 4 pilot tasks');

    const rows: string[] = [];
    for (const f of taskFiles) {
      const task = engine.loadTask(path.join(TASKS_DIR, f));
      const fixture = path.join(FIXTURES_DIR, task.pre_state.fixture_tarball);
      assert.ok(fs.existsSync(fixture), `missing fixture: ${fixture}`);

      const work = tmpDir(`cb-smoke-${task.id}`);
      try {
        execFileSync('tar', ['-xzf', fixture, '-C', work], { stdio: ['pipe', 'pipe', 'pipe'] });

        const report = engine.runValidators(task, work, { timeoutMs: 30_000 });

        // The untouched baseline MUST fail — if it passes, the validators are
        // grep-only placeholders and will pass agent garbage too.
        assert.strictEqual(
          report.passed,
          false,
          `${task.id}: validators incorrectly pass the un-modified baseline fixture. ` +
            `This means the validator set has no teeth. Report: ` +
            JSON.stringify(report, null, 2),
        );
        const firstFailed = report.validators.find((v) => !v.passed);
        rows.push(`  ${task.id} (${task.pattern}) — baseline rejected at "${firstFailed?.name}"`);
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
      }
    }
    console.log('\n' + rows.join('\n'));
  });
});

describe('Constraint-binding validator engine — adversarial', () => {
  it('times out a runaway validator instead of hanging forever', () => {
    const dir = tmpDir('cb-timeout');
    try {
      const task = {
        id: 'x',
        pattern: 'rename-then-update-callers',
        post_state_validators: [{ name: 'sleep forever', cmd: 'sleep 60' }],
      };
      const t0 = Date.now();
      const report = engine.runValidators(task, dir, { timeoutMs: 1_000 });
      const elapsed = Date.now() - t0;

      assert.strictEqual(report.passed, false);
      assert.ok(
        elapsed < 10_000,
        `runaway validator should be killed by the timeout (took ${elapsed}ms)`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs validators in the declared order, not in parallel or reversed', () => {
    const dir = tmpDir('cb-order');
    try {
      const task = {
        id: 'x',
        pattern: 'rename-then-update-callers',
        post_state_validators: [
          { name: 'first', cmd: 'touch step-1' },
          { name: 'second', cmd: 'test -f step-1 && touch step-2' },
          { name: 'third', cmd: 'test -f step-2 && touch step-3' },
        ],
      };
      const report = engine.runValidators(task, dir);
      assert.strictEqual(report.passed, true);
      assert.ok(fs.existsSync(path.join(dir, 'step-3')), 'all three steps must have run in order');
      // sanity: if the engine ran them in reverse, step-2 would fail when step-1
      // didn't yet exist
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CLI `run` emits exit-1 on validator failure so CI can gate on it', () => {
    const dir = tmpDir('cb-cli-exit');
    try {
      const yamlPath = path.join(dir, 'bad.yaml');
      fs.writeFileSync(
        yamlPath,
        [
          'id: bad',
          'name: bad',
          'pattern: rename-then-update-callers',
          'pre_state:',
          '  fixture_tarball: bad.tar.gz',
          '  source_repo: https://example.com/r',
          `  source_sha: ${'a'.repeat(40)}`,
          '  fixture_sha256: pending',
          'prompt: do the thing',
          'expected_steps_min: 1',
          'post_state_validators:',
          '  - name: will fail',
          '    cmd: exit 3',
        ].join('\n'),
      );

      let exitCode = 0;
      try {
        execSync(`node "${ENGINE}" run "${yamlPath}" "${dir}"`, { stdio: 'pipe' });
      } catch (err: unknown) {
        exitCode = (err as { status?: number }).status ?? -1;
      }
      assert.strictEqual(exitCode, 1, 'CLI must exit 1 on validator failure');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
