import { strict as assert } from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkGitDiff, checkTestExec, runOutcomeChecks } from '../../src/verifier/outcome-checks';

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outcome-checks-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  return dir;
}

function writeAndCommit(dir: string, file: string, content: string, message: string): string {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  execSync(`git add ${file} && git commit -q -m "${message}"`, { cwd: dir });
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
}

describe('checkGitDiff', () => {
  let dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs = [];
  });

  it('rejects a worker step whose only commit is the orchestrator-injected .copilot-instructions.md', () => {
    // Reproduces the astropy__astropy-13579 case from the 2026-04-30 smoke:
    // the orchestrator's prompt-builder commits .copilot-instructions.md
    // before step 1 runs; the agent then talks through a fix and runs
    // tests but never commits. With path-exclude on the verifier check,
    // the only committed change since base is .copilot-instructions.md,
    // which the gitPathspecExcludes() FILE_GLOB_EXCLUDES list filters out.
    const repo = tmpRepo();
    dirs.push(repo);
    const baseSha = writeAndCommit(repo, 'README.md', '# project\n', 'initial');
    writeAndCommit(repo, '.copilot-instructions.md', '# orchestrator scaffolding\n', 'add shared copilot instructions for swarm agents');

    const result = checkGitDiff(repo, baseSha);

    assert.strictEqual(result.type, 'git_diff');
    assert.strictEqual(result.passed, false);
    assert.match(result.reason ?? '', /No changes detected/);
  });

  it('rejects a worker step that committed only orchestrator-reserved directory contents', () => {
    // The reserved-paths list also covers runs/, plans/, and .quickfix/.
    // A commit that only touches those directories should not count as
    // agent work either.
    const repo = tmpRepo();
    dirs.push(repo);
    const baseSha = writeAndCommit(repo, 'README.md', '# project\n', 'initial');
    fs.mkdirSync(path.join(repo, 'runs', 'swarm-1', 'verification'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'runs', 'swarm-1', 'verification', 'step-1.md'), '# verified\n', 'utf8');
    execSync('git add runs && git commit -q -m "verify step 1"', { cwd: repo });

    const result = checkGitDiff(repo, baseSha);

    assert.strictEqual(result.passed, false);
    assert.match(result.reason ?? '', /No changes detected/);
  });

  it('passes when the agent commits a real source-code change', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    const baseSha = writeAndCommit(repo, 'README.md', '# project\n', 'initial');
    writeAndCommit(repo, '.copilot-instructions.md', '# scaffolding\n', 'add shared copilot instructions');
    writeAndCommit(repo, 'src/auth.py', 'def f(): return 1\n', 'fix: real agent change');

    const result = checkGitDiff(repo, baseSha);

    assert.strictEqual(result.passed, true);
    assert.match(result.evidence ?? '', /file changed|files changed/);
  });

  it('passes when the agent has uncommitted working-tree changes outside reserved paths', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    const baseSha = writeAndCommit(repo, 'README.md', '# project\n', 'initial');
    // Track src/auth.py at the base, then modify it without committing.
    writeAndCommit(repo, 'src/auth.py', 'def f(): return 1\n', 'add auth');
    fs.writeFileSync(path.join(repo, 'src', 'auth.py'), 'def f(): return 2\n', 'utf8');

    const result = checkGitDiff(repo, baseSha);

    assert.strictEqual(result.passed, true);
    assert.match(result.evidence ?? '', /file changed|files changed|file\(s\) modified/);
  });
});

/**
 * Helper: write a package.json with `scripts.test` set to the supplied
 * command. The verifier detects the test command from package.json; using
 * a real `node -e ...` invocation lets the test drive specific exit codes
 * without requiring a test framework on the host.
 */
function writePackageJson(repo: string, testScript: string): void {
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'differential-test-fixture', scripts: { test: testScript } }, null, 2),
    'utf8',
  );
}

/**
 * Helper: write package.json and commit it (so baseline state has it
 * tracked). Returns the baseline commit SHA.
 */
function commitPackageJson(repo: string, testScript: string, message: string): string {
  writePackageJson(repo, testScript);
  execSync(`git add package.json && git commit -q -m "${message}"`, { cwd: repo });
  return execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim();
}

describe('checkTestExec — baseline-differential', () => {
  let dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs = [];
  });

  it('passes when patched test command exits 0', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    writeAndCommit(repo, 'README.md', '# project\n', 'initial');
    const baseSha = commitPackageJson(repo, 'node -e "process.exit(0)"', 'add package.json');

    const result = checkTestExec(repo, process.cwd(), baseSha);

    assert.ok(result, 'expected a check result');
    assert.strictEqual(result!.type, 'test_exec');
    assert.strictEqual(result!.passed, true);
  });

  it('fails when baseline passed and patched fails (worker introduced regression)', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    writeAndCommit(repo, 'README.md', '# project\n', 'initial');
    // Baseline: green test script committed.
    const baseSha = commitPackageJson(repo, 'node -e "process.exit(0)"', 'add baseline package.json');
    // Worker commit: flip test script to fail.
    writePackageJson(repo, 'node -e "process.exit(7)"');
    execSync('git add package.json && git commit -q -m "worker change"', { cwd: repo });

    const result = checkTestExec(repo, process.cwd(), baseSha);

    assert.ok(result, 'expected a check result');
    assert.strictEqual(result!.passed, false,
      'a worker that regresses from green-baseline to failing must be rejected');
    assert.match(result!.reason ?? '', /Baseline.*passes.*patched.*exits 7.*regression/,
      'failure reason must distinguish "baseline passed, worker broke it" from "pre-existing"');
  });

  it('passes when baseline and patched both exit non-zero with the same code (pre-existing failure)', () => {
    // Regression for the 2026-05 ow run. Upstream ow main ships with
    // pre-existing xo lint errors that fail `npm test` exit-code
    // regardless of worker changes. A worker that adds a feature and
    // respects "do not modify unrelated files" must not be rejected
    // for a failure mode that was present before its commit.
    const repo = tmpRepo();
    dirs.push(repo);
    writeAndCommit(repo, 'README.md', '# project\n', 'initial');
    // Baseline package.json with a pre-existing exit-4 test command.
    const baseSha = commitPackageJson(repo, 'node -e "process.exit(4)"', 'add baseline package.json');
    // Worker added a file; package.json is unchanged so test still exits 4.
    fs.writeFileSync(path.join(repo, 'feature.js'), 'export const x = 1;', 'utf8');
    execSync('git add . && git commit -q -m "add feature"', { cwd: repo });

    const result = checkTestExec(repo, process.cwd(), baseSha);

    assert.ok(result, 'expected a check result');
    assert.strictEqual(result!.passed, true,
      'when baseline and patched fail with the same exit code, the verifier must not reject the worker for a pre-existing failure');
    assert.match(result!.evidence ?? '', /pre-existing/i,
      'evidence must explicitly name the failure as pre-existing so reviewers understand the decision');
    assert.match(result!.description, /pre-existing/i);
  });

  it('fails when baseline and patched both fail but with different exit codes', () => {
    // Exit-code divergence means the worker likely introduced a NEW
    // failure on top of a pre-existing one. Conservative: reject.
    const repo = tmpRepo();
    dirs.push(repo);
    writeAndCommit(repo, 'README.md', '# project\n', 'initial');
    const baseSha = commitPackageJson(repo, 'node -e "process.exit(2)"', 'add baseline');
    writePackageJson(repo, 'node -e "process.exit(9)"');
    execSync('git add package.json && git commit -q -m "worker change"', { cwd: repo });

    const result = checkTestExec(repo, process.cwd(), baseSha);

    assert.ok(result);
    assert.strictEqual(result!.passed, false,
      'different exit codes between baseline and patched must be treated as worker-introduced');
    assert.match(result!.reason ?? '', /Exit codes differ|treating as worker-introduced/);
  });

  it('restores the worker tree after running the baseline check', () => {
    // Critical invariant: the differential check must not leave the
    // worktree in a checked-out-baseline state. If a subsequent gate
    // reads files (build_exec, manual inspection), they must see the
    // worker's content, not the baseline.
    const repo = tmpRepo();
    dirs.push(repo);
    writeAndCommit(repo, 'README.md', '# project\n', 'initial');
    const baseSha = commitPackageJson(repo, 'node -e "process.exit(1)"', 'baseline');
    // Worker change: add a file with distinctive content.
    fs.writeFileSync(path.join(repo, 'worker-file.txt'), 'worker content\n', 'utf8');
    execSync('git add . && git commit -q -m "worker change"', { cwd: repo });

    checkTestExec(repo, process.cwd(), baseSha);

    const workerFile = path.join(repo, 'worker-file.txt');
    assert.ok(fs.existsSync(workerFile),
      'worker-file.txt must still exist after the baseline check restores worker state');
    assert.strictEqual(
      fs.readFileSync(workerFile, 'utf8'),
      'worker content\n',
      'worker-file.txt content must be intact after the baseline check',
    );
  });

  it('returns null when there is no test command in package.json', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    fs.writeFileSync(
      path.join(repo, 'package.json'),
      JSON.stringify({ name: 'no-test-script' }),
      'utf8',
    );
    const baseSha = writeAndCommit(repo, 'README.md', '# project\n', 'initial');

    const result = checkTestExec(repo, process.cwd(), baseSha);

    assert.strictEqual(result, null,
      'absence of a detectable test command is not a verifier failure — it skips this check');
  });

  it('falls back to non-differential semantics when baseSha is unresolvable', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    writeAndCommit(repo, 'README.md', '# project\n', 'initial');
    commitPackageJson(repo, 'node -e "process.exit(3)"', 'add package.json');

    // baseSha that does not exist in this repo. The check must not crash
    // and must report a clean failure based on the patched run alone.
    const bogusSha = '0000000000000000000000000000000000000000';
    const result = checkTestExec(repo, process.cwd(), bogusSha);

    assert.ok(result);
    assert.strictEqual(result!.passed, false,
      'patched test command exit non-zero with no baseline anchor must still fail');
    // Reason must not promise a baseline number we never measured.
    assert.doesNotMatch(result!.reason ?? '', /Baseline \(0+/,
      'must not fabricate a baseline run when baseSha is unresolvable');
  });
});

describe('runOutcomeChecks — auto-commit uncommitted agent work', () => {
  let dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs = [];
  });

  it('auto-commits uncommitted tracked and untracked changes before checking', () => {
    // The 2026-05 ow v4 run failure: worker fixed pre-existing blockers and
    // edited files but hit a transient API error before committing. Step
    // verification ran on the uncommitted state and "passed" (build + tests
    // saw the new files on disk). The branch merger then merged an empty
    // worker branch back to main; the falsification battery ran against
    // unchanged main and rejected the no-op patch. Auto-committing before
    // verification closes the loop: the worker's actual changes get carried
    // forward into the merge.
    const repo = tmpRepo();
    dirs.push(repo);
    const baseSha = writeAndCommit(repo, 'seed.txt', 'initial\n', 'initial');

    // Worker session "ended" with: a tracked file modified and a new file
    // created, but no commit.
    fs.writeFileSync(path.join(repo, 'seed.txt'), 'agent modified\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'new-feature.ts'), 'export const x = 1;\n', 'utf8');

    const beforeCommit = execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim();
    assert.strictEqual(beforeCommit, baseSha,
      'sanity: no commit exists before runOutcomeChecks fires');

    runOutcomeChecks({ workdir: repo, baseSha }, process.cwd());

    const afterCommit = execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim();
    assert.notStrictEqual(afterCommit, baseSha,
      'auto-commit must produce a new commit on top of baseSha so the merge picks up the work');

    const committedMessage = execSync('git log -1 --format=%B', { cwd: repo, encoding: 'utf8' }).trim();
    assert.match(committedMessage, /swarm: auto-commit/,
      'auto-commit message must identify the orchestrator as the committer so reviewers see the recovery');
    assert.match(committedMessage, /agent produced changes but did not commit/,
      'auto-commit message must name the failure mode so reviewers understand why');

    // Both files must be in the commit so the merge carries everything forward.
    const committedFiles = execSync(`git diff --name-only ${baseSha} HEAD`, { cwd: repo, encoding: 'utf8' })
      .trim()
      .split('\n')
      .sort();
    assert.deepStrictEqual(committedFiles, ['new-feature.ts', 'seed.txt'],
      'every uncommitted agent-relevant file must be in the auto-commit');
  });

  it('does not auto-commit when the worktree is clean', () => {
    // No agent changes ⇒ no commit. A spurious empty commit would
    // confuse downstream `git_diff` checks (a commit message but no
    // content change).
    const repo = tmpRepo();
    dirs.push(repo);
    const baseSha = writeAndCommit(repo, 'seed.txt', 'initial\n', 'initial');

    runOutcomeChecks({ workdir: repo, baseSha }, process.cwd());

    const afterCommit = execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim();
    assert.strictEqual(afterCommit, baseSha,
      'clean tree must not produce an auto-commit');
  });

  it('does not auto-commit orchestrator-scaffolding-only changes', () => {
    // The pre-step injection commits .copilot-instructions.md. If the
    // worker session adds nothing else, the verifier must not treat the
    // scaffolding as agent work and re-commit it under a swarm
    // auto-commit message — that would mask the empty agent step from
    // downstream gates.
    const repo = tmpRepo();
    dirs.push(repo);
    const baseSha = writeAndCommit(repo, 'seed.txt', 'initial\n', 'initial');
    // Untracked scaffolding-shaped paths the orchestrator excludes.
    fs.writeFileSync(path.join(repo, '.copilot-instructions.md'), 'orchestrator\n', 'utf8');
    fs.mkdirSync(path.join(repo, 'runs', 'inner'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'runs', 'inner', 'state.json'), '{}\n', 'utf8');

    runOutcomeChecks({ workdir: repo, baseSha }, process.cwd());

    const afterCommit = execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim();
    assert.strictEqual(afterCommit, baseSha,
      'orchestrator scaffolding only ⇒ no auto-commit (those paths are pathspec-excluded)');
  });

  it('produces a git_diff check that passes after auto-commit and reflects committed state', () => {
    // End-to-end behavior: uncommitted changes → auto-commit → git_diff
    // sees committed changes → passes with the "files changed" evidence
    // rather than the legacy "uncommitted" caveat. Downstream merge picks
    // up the commit.
    const repo = tmpRepo();
    dirs.push(repo);
    const baseSha = writeAndCommit(repo, 'seed.txt', 'initial\n', 'initial');
    fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 1;\n', 'utf8');

    const checks = runOutcomeChecks({ workdir: repo, baseSha }, process.cwd());

    const diffCheck = checks.find((c) => c.type === 'git_diff');
    assert.ok(diffCheck);
    assert.strictEqual(diffCheck!.passed, true);
    // Evidence must reflect committed state, not the "uncommitted, agent
    // completed work without committing" path that masked the bug.
    assert.doesNotMatch(diffCheck!.evidence ?? '', /uncommitted/i,
      'after auto-commit, git_diff must see committed changes and not surface the uncommitted fallback evidence');
  });
});
