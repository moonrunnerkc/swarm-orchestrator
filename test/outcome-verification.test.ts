import { strict as assert } from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import VerifierEngine, {
  VerificationCheck,
  VerificationResult,
  OutcomeVerificationOpts,
  last20Lines,
  buildFailureContext,
} from '../src/verifier-engine';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'outcome-test-'));
}

/**
 * Initialize a git repo in dir with a single initial commit.
 * Returns the SHA of that commit.
 */
function initGitRepo(dir: string): string {
  execSync('git init -b main', { cwd: dir });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config user.name "Test User"', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'initial');
  execSync('git add .', { cwd: dir });
  execSync('git commit -m "initial"', { cwd: dir });
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
}

/**
 * Write a minimal transcript that the share parser can consume.
 * Returns the path.
 */
function writeTranscript(dir: string, content?: string): string {
  const p = path.join(dir, 'transcript.md');
  fs.writeFileSync(p, content ?? '# Transcript\nNo significant activity.');
  return p;
}

describe('Outcome-Based Verification', () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      if (fs.existsSync(d)) {
        fs.rmSync(d, { recursive: true, force: true });
      }
    }
    tempDirs = [];
  });

  // ── git_diff ───────────────────────────────────────────────────

  describe('git_diff check', () => {
    it('passes when the worktree has commits beyond baseSha', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const baseSha = initGitRepo(dir);

      // Make a change after the base
      fs.writeFileSync(path.join(dir, 'feature.ts'), 'export const x = 1;');
      execSync('git add . && git commit -m "add feature"', { cwd: dir });

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      const diffCheck = result.checks.find(c => c.type === 'git_diff');
      assert.ok(diffCheck, 'should produce a git_diff check');
      assert.strictEqual(diffCheck!.passed, true);
      assert.ok(diffCheck!.evidence, 'should include diff summary');
    });

    it('fails when no changes exist since baseSha', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const baseSha = initGitRepo(dir);
      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      const diffCheck = result.checks.find(c => c.type === 'git_diff');
      assert.ok(diffCheck);
      assert.strictEqual(diffCheck!.passed, false);
      assert.ok(diffCheck!.reason!.includes(baseSha.slice(0, 8)));
    });
  });

  // ── file_existence ─────────────────────────────────────────────

  describe('file_existence check', () => {
    it('passes when all expected files are present', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const baseSha = initGitRepo(dir);
      fs.writeFileSync(path.join(dir, 'a.ts'), '');
      fs.writeFileSync(path.join(dir, 'b.ts'), '');
      execSync('git add . && git commit -m "add files"', { cwd: dir });

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha, expectedFiles: ['a.ts', 'b.ts'] }
      );

      const fileCheck = result.checks.find(c => c.type === 'file_existence');
      assert.ok(fileCheck);
      assert.strictEqual(fileCheck!.passed, true);
    });

    it('fails when expected files are missing', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const baseSha = initGitRepo(dir);

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha, expectedFiles: ['missing.ts'] }
      );

      const fileCheck = result.checks.find(c => c.type === 'file_existence');
      assert.ok(fileCheck);
      assert.strictEqual(fileCheck!.passed, false);
      assert.ok(fileCheck!.reason!.includes('missing.ts'));
    });

    it('is not generated when expectedFiles is omitted', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const baseSha = initGitRepo(dir);
      fs.writeFileSync(path.join(dir, 'x.ts'), '');
      execSync('git add . && git commit -m "x"', { cwd: dir });

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      const fileCheck = result.checks.find(c => c.type === 'file_existence');
      assert.strictEqual(fileCheck, undefined);
    });
  });

  // ── build_exec / test_exec ────────────────────────────────────

  describe('build_exec check', () => {
    it('passes when package.json has a build script that succeeds', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const pkg = { name: 'test', scripts: { build: 'echo built' } };
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

      const baseSha = initGitRepo(dir);
      // Add a change so git_diff passes too
      fs.writeFileSync(path.join(dir, 'index.ts'), 'export {}');
      execSync('git add . && git commit -m "index"', { cwd: dir });

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      const buildCheck = result.checks.find(c => c.type === 'build_exec');
      assert.ok(buildCheck, 'should produce build_exec check');
      assert.strictEqual(buildCheck!.passed, true);
    });

    it('fails when the build script exits with non-zero', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const pkg = { name: 'test', scripts: { build: 'echo "compile error" && exit 1' } };
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

      const baseSha = initGitRepo(dir);
      fs.writeFileSync(path.join(dir, 'index.ts'), 'x');
      execSync('git add . && git commit -m "bad"', { cwd: dir });

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      const buildCheck = result.checks.find(c => c.type === 'build_exec');
      assert.ok(buildCheck, 'should produce build_exec check');
      assert.strictEqual(buildCheck!.passed, false);
    });

    it('is not generated when no build script exists', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      // No package.json, no Makefile
      const baseSha = initGitRepo(dir);
      fs.writeFileSync(path.join(dir, 'x.txt'), 'y');
      execSync('git add . && git commit -m "x"', { cwd: dir });

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      const buildCheck = result.checks.find(c => c.type === 'build_exec');
      assert.strictEqual(buildCheck, undefined);
    });
  });

  describe('test_exec check', () => {
    it('passes when test script exits 0', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const pkg = { name: 'test-proj', scripts: { test: 'echo "1 passing"' } };
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

      const baseSha = initGitRepo(dir);
      fs.writeFileSync(path.join(dir, 'index.ts'), 'export {}');
      execSync('git add . && git commit -m "feat"', { cwd: dir });

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      const testCheck = result.checks.find(c => c.type === 'test_exec');
      assert.ok(testCheck);
      assert.strictEqual(testCheck!.passed, true);
    });

    it('fails when test script exits non-zero', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const pkg = { name: 'test-proj', scripts: { test: 'node -e "process.exit(1)"' } };
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

      const baseSha = initGitRepo(dir);
      fs.writeFileSync(path.join(dir, 'y.ts'), '');
      execSync('git add . && git commit -m "y"', { cwd: dir });

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      const testCheck = result.checks.find(c => c.type === 'test_exec');
      assert.ok(testCheck);
      assert.strictEqual(testCheck!.passed, false);
    });
  });

  // ── transcript demotion ────────────────────────────────────────

  describe('transcript demotion', () => {
    it('demotes transcript build/test checks when outcome exec checks exist', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const pkg = { name: 'proj', scripts: { build: 'echo ok', test: 'echo ok' } };
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

      const baseSha = initGitRepo(dir);
      fs.writeFileSync(path.join(dir, 'mod.ts'), 'export const z = 1;');
      execSync('git add . && git commit -m "mod"', { cwd: dir });

      // Transcript claims tests and build: these checks should be demoted
      const transcript = writeTranscript(dir, `# Transcript\n
\`\`\`bash
$ npm test
\`\`\`
Output:
1 passing

\`\`\`bash
$ npm run build
\`\`\`
Output:
Compiled successfully
`);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript,
        { requireTests: true, requireBuild: true },
        undefined, undefined,
        { workdir: dir, baseSha }
      );

      // Transcript-based checks should be demoted to non-required
      const transcriptBuild = result.checks.find(c => c.type === 'build');
      const transcriptTest = result.checks.find(c => c.type === 'test');
      if (transcriptBuild) {
        assert.strictEqual(transcriptBuild.required, false, 'transcript build should be demoted');
      }
      if (transcriptTest) {
        assert.strictEqual(transcriptTest.required, false, 'transcript test should be demoted');
      }

      // Outcome-based checks should remain required
      const buildExec = result.checks.find(c => c.type === 'build_exec');
      const testExec = result.checks.find(c => c.type === 'test_exec');
      assert.ok(buildExec);
      assert.ok(testExec);
      assert.strictEqual(buildExec!.required, true);
      assert.strictEqual(testExec!.required, true);
    });
  });

  // ── pass/fail semantics ───────────────────────────────────────

  describe('pass/fail logic', () => {
    it('passes when all required outcome checks pass', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const baseSha = initGitRepo(dir);
      fs.writeFileSync(path.join(dir, 'app.ts'), 'ok');
      execSync('git add . && git commit -m "app"', { cwd: dir });

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      // git_diff required check passes; no build/test scripts so no exec checks
      assert.strictEqual(result.passed, true);
    });

    it('fails when any required outcome check fails', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const baseSha = initGitRepo(dir);
      // No additional commits, so git_diff will fail

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      assert.strictEqual(result.passed, false);
    });

    it('passes when no required checks exist (no requirements, no outcomeOpts)', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      initGitRepo(dir);
      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      // No requirements, no outcomeOpts: only claim checks which are non-required
      const result = await verifier.verifyStep(1, 'dev', transcript);
      assert.strictEqual(result.passed, true);
    });
  });

  // ── result fields ─────────────────────────────────────────────

  describe('result fields', () => {
    it('includes failureContext when verification fails', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const baseSha = initGitRepo(dir);
      // No changes: git_diff will fail
      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      assert.strictEqual(result.passed, false);
      assert.ok(result.failureContext, 'should have failureContext');
      assert.ok(result.failureContext!.includes('git_diff'));
    });

    it('sets failureContext to undefined on pass', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const baseSha = initGitRepo(dir);
      fs.writeFileSync(path.join(dir, 'ok.ts'), '1');
      execSync('git add . && git commit -m "ok"', { cwd: dir });

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      assert.strictEqual(result.failureContext, undefined);
    });

    it('includes summary string', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const baseSha = initGitRepo(dir);
      fs.writeFileSync(path.join(dir, 'ok.ts'), '1');
      execSync('git add . && git commit -m "ok"', { cwd: dir });

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      assert.ok(result.summary, 'should have summary');
      assert.ok(result.summary!.includes('passed'));
    });

    it('records baseSha from outcomeOpts', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const baseSha = initGitRepo(dir);
      fs.writeFileSync(path.join(dir, 'ok.ts'), '1');
      execSync('git add . && git commit -m "ok"', { cwd: dir });

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      assert.strictEqual(result.baseSha, baseSha);
    });

    it('leaves baseSha undefined when outcomeOpts is not provided', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);
      initGitRepo(dir);

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(1, 'dev', transcript);
      assert.strictEqual(result.baseSha, undefined);
    });

    it('preserves unverifiedClaims and timestamp fields', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      const baseSha = initGitRepo(dir);
      fs.writeFileSync(path.join(dir, 'ok.ts'), '1');
      execSync('git add . && git commit -m "ok"', { cwd: dir });

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      assert.ok(Array.isArray(result.unverifiedClaims));
      assert.ok(result.timestamp);
      assert.strictEqual(result.transcriptPath, transcript);
    });
  });

  // ── helper functions ──────────────────────────────────────────

  describe('last20Lines', () => {
    it('returns full string when 20 lines or fewer', () => {
      const input = 'line1\nline2\nline3';
      assert.strictEqual(last20Lines(input), input);
    });

    it('returns only the last 20 lines when input exceeds 20', () => {
      const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`);
      const result = last20Lines(lines.join('\n'));
      assert.ok(result.startsWith('...'));
      assert.ok(result.includes('line-10'));
      assert.ok(result.includes('line-29'));
      assert.ok(!result.includes('line-9\n'));
    });

    it('returns empty string for empty input', () => {
      assert.strictEqual(last20Lines(''), '');
    });
  });

  describe('buildFailureContext', () => {
    it('returns empty string when no checks failed', () => {
      const checks: VerificationCheck[] = [
        { type: 'git_diff', description: 'ok', required: true, passed: true },
      ];
      assert.strictEqual(buildFailureContext(checks), '');
    });

    it('orders failures by actionability priority', () => {
      const checks: VerificationCheck[] = [
        { type: 'git_diff', description: 'd', required: true, passed: false, reason: 'no diff' },
        { type: 'file_existence', description: 'f', required: true, passed: false, reason: 'missing X' },
        { type: 'build_exec', description: 'b', required: true, passed: false, reason: 'build fail' },
      ];
      const ctx = buildFailureContext(checks);
      const lines = ctx.split('\n');
      // file_existence first (priority 0), then build_exec (2), then git_diff (3)
      assert.ok(lines[0].includes('file_existence'));
      assert.ok(lines[1].includes('build_exec'));
      assert.ok(lines[2].includes('git_diff'));
    });

    it('truncates to approximately 2000 characters', () => {
      const checks: VerificationCheck[] = Array.from({ length: 50 }, (_, i) => ({
        type: 'claim' as const,
        description: `check-${i}`,
        required: true,
        passed: false,
        reason: 'x'.repeat(100),
      }));
      const ctx = buildFailureContext(checks);
      assert.ok(ctx.length <= 2020); // 2000 + small overhead from truncation marker
      assert.ok(ctx.includes('(truncated)'));
    });
  });

  // ── Makefile detection ─────────────────────────────────────────

  describe('Makefile-based commands', () => {
    it('detects build target from Makefile', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      fs.writeFileSync(path.join(dir, 'Makefile'), 'build:\n\techo built\n');

      const baseSha = initGitRepo(dir);
      fs.writeFileSync(path.join(dir, 'x.c'), '// code');
      execSync('git add . && git commit -m "code"', { cwd: dir });

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      const buildCheck = result.checks.find(c => c.type === 'build_exec');
      assert.ok(buildCheck, 'should detect Makefile build target');
      assert.strictEqual(buildCheck!.passed, true);
    });

    it('detects test target from Makefile', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);

      fs.writeFileSync(path.join(dir, 'Makefile'), 'test:\n\techo "1 passing"\n');

      const baseSha = initGitRepo(dir);
      fs.writeFileSync(path.join(dir, 'x.c'), '// code');
      execSync('git add . && git commit -m "code"', { cwd: dir });

      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);

      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha }
      );

      const testCheck = result.checks.find(c => c.type === 'test_exec');
      assert.ok(testCheck, 'should detect Makefile test target');
      assert.strictEqual(testCheck!.passed, true);
    });
  });

  describe('pytest rootdir isolation (defect c regression)', function () {
    // Spawns real pytest; allow headroom
    this.timeout(30_000);

    function pytestAvailable(): boolean {
      try {
        execSync('python3 -m pytest --version', { stdio: ['pipe', 'pipe', 'pipe'] });
        return true;
      } catch {
        return false;
      }
    }

    before(function () {
      if (!pytestAvailable()) this.skip();
    });

    it('does not double-collect a conftest.py hidden inside an orchestrator runs/ subtree', async () => {
      // Reproduces the sympy__sympy-12481 pilot failure: a repo whose conftest
      // defines pytest options, with a worktree under `runs/` that contains a
      // copy of the same conftest. Without --rootdir + --ignore, pytest's
      // rootdir search walks up and registers BOTH conftests, tripping
      // `ValueError: option names {'--slow'} already added`.
      const dir = tmpDir();
      tempDirs.push(dir);
      const baseSha = initGitRepo(dir);

      const conftest = `
import pytest
def pytest_addoption(parser):
    parser.addoption("--slow", dest="runslow", action="store_true",
                     default=False, help="run slow tests")
`;
      fs.writeFileSync(path.join(dir, 'conftest.py'), conftest);
      fs.writeFileSync(
        path.join(dir, 'test_trivial.py'),
        'def test_two_plus_two():\n    assert 2 + 2 == 4\n',
      );
      fs.writeFileSync(
        path.join(dir, 'requirements.txt'),
        'pytest\n',
      );

      // Simulate the orchestrator's worktree shape: runs/swarm-*/worktrees/step-1
      // gets the same conftest (because the worktree is effectively a copy of
      // the repo tree for that branch). Pre-fix, pytest discovered both.
      const worktreePath = path.join(dir, 'runs', 'swarm-regression', 'worktrees', 'step-1');
      fs.mkdirSync(worktreePath, { recursive: true });
      fs.writeFileSync(path.join(worktreePath, 'conftest.py'), conftest);
      fs.writeFileSync(
        path.join(worktreePath, 'test_trivial.py'),
        'def test_three_plus_three():\n    assert 3 + 3 == 6\n',
      );

      execSync('git add . && git commit -m "seed"', {
        cwd: dir,
        env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
               GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
      });

      // Sanity check: the pre-fix invocation (no flags) actually errors on
      // the double-registration. This locks in *why* the fix is needed.
      let preFixRaised = false;
      try {
        execSync('python3 -m pytest', {
          cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000,
        });
      } catch (err: unknown) {
        const out = (err as { stdout?: Buffer; stderr?: Buffer });
        const msg =
          (out.stdout ? out.stdout.toString() : '') +
          (out.stderr ? out.stderr.toString() : '');
        if (/option names \{'--slow'\} already added/.test(msg)) {
          preFixRaised = true;
        }
      }
      assert.ok(
        preFixRaised,
        'precondition: the raw `python3 -m pytest` invocation must trip the ' +
          'double-registration error for this test to prove anything',
      );

      // Now run via the verifier — the fixed pytestCmd includes --rootdir and
      // --ignore, which must suppress the double-collection.
      const transcript = writeTranscript(dir);
      const verifier = new VerifierEngine(dir);
      const result = await verifier.verifyStep(
        1, 'dev', transcript, undefined, undefined, undefined,
        { workdir: dir, baseSha },
      );

      const testCheck = result.checks.find(c => c.type === 'test_exec');
      assert.ok(testCheck, 'verifier should have produced a test_exec check');
      assert.strictEqual(
        testCheck!.passed,
        true,
        `verifier must succeed despite the parent-worktree conftest: ${testCheck!.reason ?? ''}`,
      );
    });
  });
});
