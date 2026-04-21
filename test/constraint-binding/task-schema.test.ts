import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TASKS_DIR = path.join(REPO_ROOT, 'benchmarks', 'constraint-binding', 'tasks');
const ENGINE = path.join(REPO_ROOT, 'benchmarks', 'constraint-binding', 'validator-engine.js');

const engine: {
  loadTask: (p: string) => Record<string, unknown>;
  validateTask: (t: unknown, label?: string) => void;
  runValidators: (t: unknown, workdir: string) => { passed: boolean; validators: unknown[] };
  lintTasksDir: (dir: string) => { ok: boolean; count: number; errors: string[] };
  ALLOWED_PATTERNS: readonly string[];
} = require(ENGINE);

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

describe('Constraint-binding task schema', () => {
  let scratch: string[] = [];

  afterEach(() => {
    for (const d of scratch) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
    scratch = [];
  });

  it('every shipped task YAML passes lint', () => {
    const result = engine.lintTasksDir(TASKS_DIR);
    assert.ok(result.ok, `lint errors: ${result.errors.join('; ')}`);
    assert.strictEqual(result.count, 4, 'expected 4 pilot tasks in Phase 3a');
  });

  it('each pilot task covers a distinct pattern', () => {
    const tasks = fs
      .readdirSync(TASKS_DIR)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => engine.loadTask(path.join(TASKS_DIR, f)));
    const patterns = new Set(tasks.map((t) => t.pattern as string));
    assert.strictEqual(patterns.size, 4, `patterns should be distinct, got ${[...patterns].join(',')}`);
    for (const p of patterns) {
      assert.ok(engine.ALLOWED_PATTERNS.includes(p), `pattern ${p} not in allowed set`);
    }
  });

  it('rejects a task missing required top-level fields', () => {
    const task = {
      id: 'no-prompt',
      name: 'x',
      pattern: 'rename-then-update-callers',
      pre_state: {
        fixture_tarball: 't.tar.gz',
        source_repo: 'https://example.com/r',
        source_sha: 'a'.repeat(40),
        fixture_sha256: 'pending',
      },
      expected_steps_min: 1,
      post_state_validators: [{ name: 'x', cmd: 'true' }],
    };
    assert.throws(() => engine.validateTask(task), /missing required field "prompt"/);
  });

  it('rejects a task where source_sha is not a 40-char hex string', () => {
    const task = {
      id: 'bad-sha',
      name: 'x',
      pattern: 'rename-then-update-callers',
      pre_state: {
        fixture_tarball: 't.tar.gz',
        source_repo: 'https://example.com/r',
        source_sha: 'not-a-sha',
        fixture_sha256: 'pending',
      },
      prompt: 'do a thing',
      expected_steps_min: 1,
      post_state_validators: [{ name: 'x', cmd: 'true' }],
    };
    assert.throws(() => engine.validateTask(task), /40-char hex SHA-1/);
  });

  it('rejects a task with an unknown pattern', () => {
    const task = {
      id: 'bad-pattern',
      name: 'x',
      pattern: 'make-it-work',
      pre_state: {
        fixture_tarball: 't.tar.gz',
        source_repo: 'https://example.com/r',
        source_sha: 'a'.repeat(40),
        fixture_sha256: 'pending',
      },
      prompt: 'do a thing',
      expected_steps_min: 1,
      post_state_validators: [{ name: 'x', cmd: 'true' }],
    };
    assert.throws(() => engine.validateTask(task), /not in allowed set/);
  });
});

describe('Constraint-binding validator runner', () => {
  let scratch: string[] = [];

  afterEach(() => {
    for (const d of scratch) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
    scratch = [];
  });

  it('reports passed=true when every validator exits 0', () => {
    const dir = tmpDir('cb-validate-pass');
    scratch.push(dir);
    fs.writeFileSync(path.join(dir, 'target.txt'), 'hello');

    const task = {
      id: 'x',
      post_state_validators: [
        { name: 'file exists', cmd: 'test -f target.txt' },
        { name: 'content matches', cmd: 'grep -q hello target.txt' },
      ],
      pattern: 'rename-then-update-callers',
    };
    const report = engine.runValidators(task, dir);
    assert.strictEqual(report.passed, true);
    assert.strictEqual(report.validators.length, 2);
  });

  it('stops at the first failing validator and records the exit code', () => {
    const dir = tmpDir('cb-validate-fail');
    scratch.push(dir);

    const task = {
      id: 'x',
      post_state_validators: [
        { name: 'first passes', cmd: 'true' },
        { name: 'second fails', cmd: 'exit 7' },
        { name: 'third would have run', cmd: 'true' },
      ],
      pattern: 'rename-then-update-callers',
    };
    const report = engine.runValidators(task, dir) as {
      passed: boolean;
      validators: Array<{ passed: boolean; exitCode: number; name: string }>;
    };
    assert.strictEqual(report.passed, false);
    assert.strictEqual(report.validators.length, 2, 'must stop after the first fail');
    assert.strictEqual(report.validators[1].exitCode, 7);
  });

  it('CLI entrypoint lints the shipped tasks dir cleanly', () => {
    const out = execFileSync('node', [ENGINE, 'lint', TASKS_DIR], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    assert.match(out, /✓ 4 task\(s\) .* passed schema validation/);
  });
});
