import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentAdapter, AgentResult, AgentSpawnOptions } from '../../src/adapters/agent-adapter';
import { DEFAULT_TIMEOUT_MS, synthesizeRegressionTest } from '../../src/verification';

class FakeAdapter implements AgentAdapter {
  readonly name = 'fake';
  private calls = 0;

  constructor(private readonly responses: string[]) {}

  get callCount(): number {
    return this.calls;
  }

  async spawn(_opts: AgentSpawnOptions): Promise<AgentResult> {
    const response = this.responses[this.calls] ?? this.responses[this.responses.length - 1] ?? '{}';
    this.calls += 1;
    return {
      stdout: response,
      stderr: '',
      exitCode: 0,
      durationMs: 1,
    };
  }
}

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'synth-test-'));
}

function candidate(source: string): string {
  return JSON.stringify({
    testFilePath: 'regression.test.js',
    testCommand: 'node {{TEST_FILE}}',
    testSource: source,
  });
}

describe('test synthesizer', () => {
  let dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs = [];
  });

  it('regenerates when a candidate passes against the base codebase', async () => {
    const repo = tmpRepo();
    dirs.push(repo);
    const adapter = new FakeAdapter([
      candidate("const assert = require('assert');\nassert.strictEqual(1, 1);\n"),
      candidate("const assert = require('assert');\nassert.strictEqual(1, 2);\n"),
    ]);

    const result = await synthesizeRegressionTest({
      goalText: 'Generate a failing regression test',
      targetRepoPath: repo,
      adapter,
      maxAttempts: 2,
      timeoutMs: 30_000,
    });

    assert.strictEqual(result.status, 'GENERATED');
    assert.strictEqual(adapter.callCount, 2);
    assert.strictEqual(result.attempts[0].commandResult?.exitCode, 0);
    assert.match(result.attempts[0].rejectionReason ?? '', /passed against the unfixed codebase/);
    assert.notStrictEqual(result.attempts[1].commandResult?.exitCode, 0);
    // Candidates land at repo root with the swarm-synth-attempt prefix so
    // their __file__ resolves to the worktree root, not a subdirectory the
    // candidate's import workarounds can't reach.
    assert.ok(result.testFilePath?.startsWith(repo));
    assert.ok(path.basename(result.testFilePath ?? '').startsWith('swarm_synth_attempt_'));
    assert.strictEqual(path.dirname(result.testFilePath ?? ''), repo);
  });

  it('forwards the configured timeoutMs to the adapter spawn', async () => {
    // The 2026-05-02 multi-repo Layer 1 sweep had four `Process killed
    // after 120s of no output` rejections (sphinx, pylint, one Django)
    // because the synthesizer's default timeout was 120_000 — shorter
    // than Claude Code's own 600_000 stall budget. The adapter receives
    // the synthesizer's timeoutMs as its `timeout` field; this test
    // pins that contract so a future regression cannot silently shrink
    // it again.
    const observed: Array<{ timeout: number | undefined }> = [];
    class TimeoutObservingAdapter implements AgentAdapter {
      readonly name = 'observing';
      async spawn(opts: AgentSpawnOptions): Promise<AgentResult> {
        observed.push({ timeout: opts.timeout });
        return {
          stdout: candidate("const assert = require('assert');\nassert.strictEqual(1, 2);\n"),
          stderr: '',
          exitCode: 0,
          durationMs: 1,
        };
      }
    }
    const repo = tmpRepo();
    dirs.push(repo);

    await synthesizeRegressionTest({
      goalText: 'goal',
      targetRepoPath: repo,
      adapter: new TimeoutObservingAdapter(),
      maxAttempts: 1,
    });
    assert.equal(observed[0]?.timeout, DEFAULT_TIMEOUT_MS,
      'default timeout must equal DEFAULT_TIMEOUT_MS so hard prompts do not stall-fail');
    assert.equal(DEFAULT_TIMEOUT_MS, 600_000,
      'DEFAULT_TIMEOUT_MS must match claude-code-adapter STALL_TIMEOUT_MS (600_000)');

    observed.length = 0;
    await synthesizeRegressionTest({
      goalText: 'goal',
      targetRepoPath: repo,
      adapter: new TimeoutObservingAdapter(),
      maxAttempts: 1,
      timeoutMs: 45_000,
    });
    assert.equal(observed[0]?.timeout, 45_000,
      'explicit timeoutMs must override the default');
  });

  it('injects framework-specific prompt guidance for the detected framework', async () => {
    // The Django profile guidance is the most distinctive — it tells the
    // LLM to place tests under tests/<app_label>/. If the synthesizer
    // detects django-runtests but injects pytest guidance instead (or
    // vice versa), the failure mode is the Mode 1 file-placement bug
    // from v7-critical-path session 2 returning. Capturing the prompt
    // pins the contract: framework detection, placement guidance, and
    // testCommand template all flow through this string.
    const repo = tmpRepo();
    dirs.push(repo);
    fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'tests', 'runtests.py'), '# django runner', 'utf8');

    const observedPrompts: string[] = [];
    class PromptCapturingAdapter implements AgentAdapter {
      readonly name = 'prompt-capturing';
      async spawn(opts: AgentSpawnOptions): Promise<AgentResult> {
        observedPrompts.push(opts.prompt);
        return {
          stdout: candidate("const assert = require('assert');\nassert.strictEqual(1, 2);\n"),
          stderr: '',
          exitCode: 0,
          durationMs: 1,
        };
      }
    }

    await synthesizeRegressionTest({
      goalText: 'goal',
      targetRepoPath: repo,
      adapter: new PromptCapturingAdapter(),
      maxAttempts: 1,
      timeoutMs: 30_000,
    });

    assert.equal(observedPrompts.length, 1);
    const prompt = observedPrompts[0]!;
    assert.match(prompt, /Django dev-checkout/);
    assert.match(prompt, /tests\/runtests\.py/);
    assert.match(prompt, /tests\/<app_label>\//,
      'Django guidance must direct the LLM to place tests under tests/<app_label>/');
    assert.match(prompt, /tests\/file_storage\/test_<name>\.py/,
      'Django guidance must show a worked example of the placement convention');
    // The no-hardcoded-venv guidance must be in the prompt regardless of
    // framework — it is the prompt-side mitigation for Mode 2 (pylint
    // hardcoded `.venv/bin/python`).
    assert.match(prompt, /do NOT hardcode.*\.venv/i);
  });

  it('preserves directory structure for Django runtests-shaped repos', async () => {
    const repo = tmpRepo();
    dirs.push(repo);
    // Marker for django-runtests detection. The file body must exit
    // non-zero when invoked so the synthesizer's base run sees the
    // candidate as a failing regression test (and therefore reaches
    // GENERATED). A bare comment exits 0 on any host where `python` is
    // resolvable (e.g. CI runners with setup-python installed), which
    // would make the synthesizer reject the candidate as "passes against
    // base" and break this placement contract for environment reasons
    // unrelated to the actual contract under test.
    fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'tests', 'runtests.py'),
      'import sys\nsys.exit(1)\n',
      'utf8',
    );

    const adapter = new FakeAdapter([
      JSON.stringify({
        testFilePath: 'tests/file_storage/test_default_upload_permissions.py',
        testCommand: 'python tests/runtests.py file_storage.test_default_upload_permissions',
        testSource: 'def test_x():\n    assert False\n',
      }),
    ]);

    const result = await synthesizeRegressionTest({
      goalText: 'Django regression test',
      targetRepoPath: repo,
      adapter,
      maxAttempts: 1,
      timeoutMs: 30_000,
    });

    // Status is GENERATED when the test fails on base; the synthesizer's
    // own base-run executes the testCommand. With no Django installed in
    // the tmp repo, runtests.py either errors out (non-zero exit, accepted)
    // or the file isn't found (also non-zero). Either way, the status
    // reaches GENERATED. We assert on the placement, not the run outcome.
    assert.notEqual(result.status, 'GENERATION_FAILED');
    const written = result.testFilePath ?? '';
    assert.match(
      path.relative(repo, written),
      /^tests\/file_storage\/swarm_synth_attempt_1_test_default_upload_permissions\.py$/,
      `Django profile must preserve tests/file_storage/ and prefix only the basename; got ${path.relative(repo, written)}`,
    );
    assert.ok(fs.existsSync(written), 'the test file must actually exist on disk where the synthesizer reports it');
    // Django's runtests.py imports modules by dotted name; the testCommand
    // must reference the prefixed basename, not the LLM's original stem,
    // or runtests.py will raise ModuleNotFoundError on the prefixed file.
    // Underscores (rather than hyphens) in the prefix make the stem a
    // valid Python module identifier; the rewrite makes the dotted
    // reference match it.
    const cmd = result.testCommand ?? '';
    assert.match(cmd, /file_storage\.swarm_synth_attempt_1_test_default_upload_permissions/,
      `Django testCommand must rewrite the dotted module name to the prefixed stem; got ${cmd}`);
    assert.doesNotMatch(cmd, /file_storage\.test_default_upload_permissions(?![a-zA-Z0-9_])/,
      `the original (un-prefixed) dotted name must not survive the rewrite; got ${cmd}`);
  });

  it('flattens to repo root for non-Django frameworks', async () => {
    const repo = tmpRepo();
    dirs.push(repo);
    // Marker for pytest-standard detection (conftest at root).
    fs.writeFileSync(path.join(repo, 'conftest.py'), '# pytest fixtures', 'utf8');

    const adapter = new FakeAdapter([
      JSON.stringify({
        // LLM proposes a deep path; non-Django profile must flatten it.
        testFilePath: 'src/deeply/nested/test_thing.py',
        testCommand: 'python -m pytest {{TEST_FILE}} -v',
        testSource: 'def test_x():\n    assert False\n',
      }),
    ]);

    const result = await synthesizeRegressionTest({
      goalText: 'pytest regression test',
      targetRepoPath: repo,
      adapter,
      maxAttempts: 1,
      timeoutMs: 30_000,
    });

    assert.notEqual(result.status, 'GENERATION_FAILED');
    const written = result.testFilePath ?? '';
    const rel = path.relative(repo, written);
    assert.match(rel, /^swarm_synth_attempt_1_test_thing\.py$/,
      `pytest profile must flatten to repo root; got ${rel}`);
  });

  it('rewrites hardcoded .venv/bin/python in testCommand to bare executable', async () => {
    const repo = tmpRepo();
    dirs.push(repo);
    fs.writeFileSync(path.join(repo, 'conftest.py'), '# pytest fixtures', 'utf8');

    const adapter = new FakeAdapter([
      JSON.stringify({
        testFilePath: 'test_thing.py',
        // The Mode 2 shape from pylint-dev__pylint-6528.
        testCommand: '.venv/bin/python -m pytest {{TEST_FILE}} -v',
        testSource: 'def test_x():\n    assert False\n',
      }),
    ]);

    const result = await synthesizeRegressionTest({
      goalText: 'pylint-style regression test',
      targetRepoPath: repo,
      adapter,
      maxAttempts: 1,
      timeoutMs: 30_000,
    });

    const finalCommand = result.testCommand ?? '';
    assert.doesNotMatch(finalCommand, /\.venv\/bin\//,
      `testCommand must not contain a hardcoded .venv/bin/ path after sanitization; got ${finalCommand}`);
    assert.match(finalCommand, /\bpython\b/,
      'sanitization must leave a bare `python` executable name in place of the hardcoded path');
  });

  it('rejects a candidate whose pytest --collect-only fails', async () => {
    const repo = tmpRepo();
    dirs.push(repo);
    fs.writeFileSync(path.join(repo, 'conftest.py'), '# pytest fixtures', 'utf8');

    // First attempt: structurally broken Python (undefined import). pytest
    // --collect-only will exit non-zero and the synthesizer must reject it.
    // Second attempt: structurally valid Python that fails its assertion.
    const broken = JSON.stringify({
      testFilePath: 'test_broken.py',
      testCommand: 'python -m pytest {{TEST_FILE}} -v',
      testSource: 'from this_module_does_not_exist_anywhere import something\n\ndef test_x():\n    assert False\n',
    });
    const valid = JSON.stringify({
      testFilePath: 'test_valid.py',
      testCommand: 'python -m pytest {{TEST_FILE}} -v',
      testSource: 'def test_x():\n    assert False\n',
    });
    const adapter = new FakeAdapter([broken, valid]);

    const result = await synthesizeRegressionTest({
      goalText: 'goal',
      targetRepoPath: repo,
      adapter,
      maxAttempts: 2,
      timeoutMs: 30_000,
    });

    // The first attempt is rejected with collection-error feedback; the
    // second attempt's valid Python is accepted (its assertion fails ⇒
    // exit non-zero ⇒ the synthesizer treats it as catching a bug).
    assert.equal(result.status, 'GENERATED',
      `expected GENERATED on the second attempt; got ${result.status}`);
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0].validation, 'rejected');
    assert.match(result.attempts[0].rejectionReason ?? '',
      /could not be collected by pytest/,
      'first-attempt feedback must be the collection-error category');
    assert.equal(result.attempts[1].validation, 'accepted');
  });

  it('returns AMBIGUOUS_GOAL when every candidate passes against base', async () => {
    const repo = tmpRepo();
    dirs.push(repo);
    const adapter = new FakeAdapter([
      candidate("const assert = require('assert');\nassert.strictEqual(1, 1);\n"),
      candidate("const assert = require('assert');\nassert.strictEqual(2, 2);\n"),
      candidate("const assert = require('assert');\nassert.deepStrictEqual([1], [1]);\n"),
    ]);

    const result = await synthesizeRegressionTest({
      goalText: 'Ambiguous request',
      targetRepoPath: repo,
      adapter,
      maxAttempts: 3,
      timeoutMs: 30_000,
    });

    assert.strictEqual(result.status, 'AMBIGUOUS_GOAL');
    assert.strictEqual(adapter.callCount, 3);
    assert.strictEqual(result.testCommand, undefined);
  });
});
