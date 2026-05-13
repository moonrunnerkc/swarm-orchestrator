import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type {
  OutcomeVerificationOpts,
  VerificationCheck,
} from '../verifier-engine';
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_SIGKILL_DELAY_MS,
} from '../defaults';
import { getLogger } from '../logger';
import { gitPathspecExcludes } from '../worktree-reserved-paths';

const logger = getLogger('verifier:outcome');

function last20Lines(output: string): string {
  const lines = output.split('\n');
  if (lines.length <= 20) return output;
  return '...\n' + lines.slice(-20).join('\n');
}

/**
 * Stage and commit any uncommitted agent-relevant work in the worktree so
 * the subsequent merge picks it up. Orchestrator scaffolding paths
 * (.copilot-instructions.md, `runs/`, `plans/`, etc.) are excluded so
 * pre-step injection commits do not get re-committed under the step's
 * auto-commit. Best-effort — any git failure leaves the worktree as-is
 * and the verifier proceeds with whatever state it can observe.
 *
 * The auto-commit fires only when there is at least one agent-relevant
 * uncommitted change after exclusion. A clean tree returns early and
 * produces no commit, so this is a no-op for the common case where the
 * agent did call `git commit`.
 *
 * Commit author identity is whatever git resolves in the worktree
 * environment (typically the orchestrator's GIT_AUTHOR_NAME=
 * "swarm-orchestrator" set in the copilot adapter env). The commit
 * message is explicit so a reviewer can see exactly which work the
 * orchestrator recovered.
 */
function autoCommitUncommittedWork(workdir: string): void {
  const timeout = DEFAULT_SIGKILL_DELAY_MS * 2;
  const pathspecArgs = gitPathspecExcludes().map((a) => `'${a}'`).join(' ');
  let phase = 'init';
  try {
    // Probe: is there anything to commit? Combined check covers tracked
    // modifications, staged changes, and untracked files (-uall) in one
    // call. Pathspec exclusion strips orchestrator scaffolding.
    phase = 'status';
    const status = execSync(
      `git status --porcelain -uall -- . ${pathspecArgs}`,
      { cwd: workdir, encoding: 'utf8', timeout, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    if (!status.trim()) {
      logger.debug(`auto-commit: clean tree at ${workdir} (status empty)`);
      return;
    }
    const statusLineCount = status.split('\n').filter(Boolean).length;

    // Stage everything agent-relevant. `-A` covers add/modify/delete on
    // tracked AND untracked paths; the pathspec keeps orchestrator
    // scaffolding out of the staging area.
    phase = 'add';
    execSync(`git add -A -- . ${pathspecArgs}`, {
      cwd: workdir,
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Confirm something is actually staged before committing — if every
    // status entry was a path the exclusion list filters during `add`,
    // we would otherwise create an empty commit.
    phase = 'diff-cached';
    const stagedSummary = execSync('git diff --cached --name-only', {
      cwd: workdir,
      encoding: 'utf8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (!stagedSummary) {
      logger.warn(
        `auto-commit: ${statusLineCount} status entries but nothing staged after add at ${workdir} ` +
          '(pathspec excludes filtered everything; agent-relevant work was lost)',
      );
      return;
    }

    const fileCount = stagedSummary.split('\n').filter(Boolean).length;
    const message =
      `swarm: auto-commit ${fileCount} uncommitted file(s) ` +
      `(agent produced changes but did not commit before exit; recovered for merge)`;
    phase = 'commit';
    execSync(`git commit -q -m ${shellQuote(message)}`, {
      cwd: workdir,
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    logger.info(
      `auto-commit: recovered ${fileCount} uncommitted file(s) at ${workdir} ` +
        '(agent exited without committing — likely a transient session error mid-edit)',
    );
  } catch (err) {
    // Auto-commit is best-effort, but a silent failure here is exactly
    // the failure mode the 2026-05-13 ow v6 run exhibited: the agent's
    // work was uncommitted, both this auto-commit and the upstream
    // step-executor auto-commit silently failed, and the merge brought
    // nothing forward. Logging the phase + stderr at WARN ensures the
    // next failure leaves a trail.
    const stderr =
      typeof err === 'object' && err !== null && 'stderr' in err
        ? String((err as { stderr?: unknown }).stderr ?? '').slice(0, 400)
        : '';
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(
      `auto-commit: failed at phase=${phase} workdir=${workdir} reason=${reason.split('\n')[0]} stderr=${JSON.stringify(stderr)}`,
    );
  }
}

/**
 * Shell-quote a string for safe embedding in an `execSync` command line.
 * The verifier runs git through the default shell, so unsanitized
 * messages with single quotes would break the commit. Strategy: wrap in
 * single quotes and escape any embedded single quote with the standard
 * `'\''` POSIX form.
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function runOutcomeChecks(
  opts: OutcomeVerificationOpts,
  workingDir: string
): VerificationCheck[] {
  const checks: VerificationCheck[] = [];

  // Auto-commit uncommitted work before checks. The branch merger merges
  // *committed* state; uncommitted changes in the worktree are dropped on
  // merge. Without auto-commit, an agent that edited files but exited
  // before calling `git commit` (transient API error, hit a timeout, etc.)
  // produces a worktree that passes verification (uncommitted changes are
  // visible to build_exec / test_exec / git_diff) but contributes nothing
  // to the merged state — main stays unchanged, the falsification battery
  // runs against unchanged code, and differential-gate fails because the
  // synthesized test does not pass on a repo that never received the fix.
  //
  // The 2026-05-13 ow v4 run exhibits this exactly: the worker fixed the
  // pre-existing lint blockers, ran tests, then hit `Request failed due
  // to a transient API error. Retrying...` before committing. Step-1
  // verified PASSED on uncommitted changes; merge brought nothing to main;
  // battery rejected the no-op patch. Auto-committing the uncommitted
  // work before verification closes that loop.
  autoCommitUncommittedWork(opts.workdir);

  checks.push(checkGitDiff(opts.workdir, opts.baseSha));

  if (opts.expectedFiles && opts.expectedFiles.length > 0) {
    checks.push(checkFileExistence(opts.workdir, opts.expectedFiles));
  }

  const buildCheck = checkBuildExec(opts.workdir);
  if (buildCheck) {
    checks.push(buildCheck);
  }

  if (process.env.SWARM_SKIP_OUTCOME_TEST_EXEC !== '1') {
    const testCheck = checkTestExec(opts.workdir, workingDir, opts.baseSha);
    if (testCheck) {
      checks.push(testCheck);
    }
  }

  // Idempotency resolution: if the diff check failed (no new commits) but the
  // build and tests both pass, the goal state is demonstrably achieved. Downgrade
  // git_diff from a hard failure to an advisory warning so an agent that found
  // its work already present does not block the step from merging.
  // Requires at least one exec check to be present; absence of scripts is not
  // treated as a pass since that would mask genuinely empty agent runs.
  const diffCheck = checks.find((c) => c.type === 'git_diff');
  if (diffCheck && !diffCheck.passed) {
    const buildExecCheck = checks.find((c) => c.type === 'build_exec');
    const testExecCheck = checks.find((c) => c.type === 'test_exec');
    const hasExecEvidence = buildExecCheck !== undefined || testExecCheck !== undefined;
    const buildPassed = buildExecCheck ? buildExecCheck.passed : true;
    const testsPassed = testExecCheck ? testExecCheck.passed : true;
    if (hasExecEvidence && buildPassed && testsPassed) {
      diffCheck.required = false;
      diffCheck.passed = true;
      diffCheck.evidence =
        `${diffCheck.reason ?? 'No new commits'} — build and tests confirm goal already achieved (idempotent)`;
      delete diffCheck.reason;
    }
  }

  return checks;
}

/**
 * Check whether the worker step actually committed agent work.
 *
 * Excludes orchestrator-injected paths (`.copilot-instructions.md`,
 * `runs/`, etc.) from the diff so the prompt-builder's pre-step commits
 * do not count as "agent produced code changes." Without this exclusion
 * a worker that talked through the fix and ran tests locally but never
 * committed would still pass the verifier — observed on
 * astropy__astropy-13579 (2026-04-30 smoke), where `.copilot-instructions.md`
 * (736 lines, committed by `src/prompt-builder.ts` before step 1 runs)
 * was the only thing in the diff and the verifier passed the step.
 */
export function checkGitDiff(workdir: string, baseSha: string): VerificationCheck {
  const timeout = DEFAULT_SIGKILL_DELAY_MS * 2;
  // Each pathspec like `:(exclude)runs` and `:(exclude)runs/**` is shell-safe
  // because the only special characters are ` ` and `()` — wrap in single
  // quotes for the execSync (shell: true) invocation.
  const pathspecArgs = gitPathspecExcludes().map(a => `'${a}'`).join(' ');
  try {
    // Primary: committed changes since baseline, excluding orchestrator scaffolding.
    const committedDiff = execSync(
      `git diff --stat ${baseSha}..HEAD -- . ${pathspecArgs}`,
      { cwd: workdir, encoding: 'utf8', timeout }
    ).trim();

    if (committedDiff) {
      const lines = committedDiff.split('\n');
      const summaryLine = lines[lines.length - 1] || '';
      return {
        type: 'git_diff',
        description: 'Agent produced code changes',
        required: true,
        passed: true,
        evidence: summaryLine.trim(),
      };
    }

    // Secondary: uncommitted working-tree changes (agent wrote files but did
    // not commit), with the same exclusions.
    const unstagedDiff = execSync(
      `git diff --stat HEAD -- . ${pathspecArgs}`,
      { cwd: workdir, encoding: 'utf8', timeout }
    ).trim();

    // -uno excludes untracked files; the pathspec excludes orchestrator
    // scaffolding that is tracked but agent-irrelevant.
    const statusOutput = execSync(
      `git status --porcelain -uno -- . ${pathspecArgs}`,
      { cwd: workdir, encoding: 'utf8', timeout }
    ).trim();

    if (unstagedDiff || statusOutput) {
      const fileCount = statusOutput ? statusOutput.split('\n').filter(Boolean).length : 0;
      return {
        type: 'git_diff',
        description: 'Agent produced code changes',
        required: true,
        passed: true,
        evidence: `${fileCount} file(s) modified in working tree (uncommitted) — agent completed work without committing`,
      };
    }

    // No committed or uncommitted changes outside reserved paths: record for
    // idempotency resolution above.
    return {
      type: 'git_diff',
      description: 'Agent produced code changes',
      required: true,
      passed: false,
      reason: `No changes detected since ${baseSha.slice(0, 8)}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: 'git_diff',
      description: 'Agent produced code changes',
      required: true,
      passed: false,
      reason: `git diff failed: ${msg.split('\n')[0]}`,
    };
  }
}

function checkFileExistence(workdir: string, expectedFiles: string[]): VerificationCheck {
  const missing: string[] = [];
  const present: string[] = [];

  for (const file of expectedFiles) {
    const fullPath = path.join(workdir, file);
    if (fs.existsSync(fullPath)) {
      present.push(file);
    } else {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    return {
      type: 'file_existence',
      description: 'Expected files exist in worktree',
      required: true,
      passed: false,
      reason: `Missing files: ${missing.join(', ')}`,
      evidence: `${present.length}/${expectedFiles.length} present`,
    };
  }

  return {
    type: 'file_existence',
    description: 'Expected files exist in worktree',
    required: true,
    passed: true,
    evidence: `All ${expectedFiles.length} expected file(s) found`,
  };
}

function checkBuildExec(workdir: string): VerificationCheck | null {
  const buildCmd = detectBuildCommand(workdir);
  if (!buildCmd) return null;

  try {
    execSync(buildCmd, {
      cwd: workdir,
      encoding: 'utf8',
      timeout: DEFAULT_COMMAND_TIMEOUT_MS / 2,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return {
      type: 'build_exec',
      description: `Build succeeded (${buildCmd})`,
      required: true,
      passed: true,
      evidence: `Ran "${buildCmd}" in worktree`,
    };
  } catch (err: unknown) {
    const output = extractCommandOutput(err);
    return {
      type: 'build_exec',
      description: `Build failed (${buildCmd})`,
      required: true,
      passed: false,
      reason: last20Lines(output),
    };
  }
}

export function checkTestExec(
  workdir: string,
  workingDir: string,
  baseSha: string,
): VerificationCheck | null {
  const testCmd = detectTestCommand(workdir, workingDir);
  if (!testCmd) return null;

  try {
    execSync(testCmd, {
      cwd: workdir,
      encoding: 'utf8',
      timeout: DEFAULT_COMMAND_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return {
      type: 'test_exec',
      description: `Tests passed (${testCmd})`,
      required: true,
      passed: true,
      evidence: `Ran "${testCmd}" in worktree`,
    };
  } catch (err: unknown) {
    const output = extractCommandOutput(err);
    const patchedExitCode = readExitCode(err);

    if (testCmd === 'npm test' && output.includes('MODULE_NOT_FOUND')) {
      const fallback = retryTestWithAutoDiscovery(workdir);
      if (fallback) return fallback;
    }

    // Baseline-differential safety net. The plan-generator's shared acceptance
    // criteria already direct the worker to fix pre-existing tooling failures
    // that block `npm test`. This check is defense-in-depth: if the worker
    // legitimately could not fix a pre-existing failure (env-dependent,
    // requires deps not present, etc.), the verifier must not false-fail. We
    // run the same test command against the baseline commit and compare
    // exit codes — patched no-worse-than-baseline counts as "worker
    // introduced no new test regression detectable by exit code."
    //
    // Without this safety net, the 2026-05 ow run hit a deadlock: ow's
    // upstream main shipped with 4 xo lint errors that fail `npm test`
    // before ava runs. A worker that adds a feature and faithfully
    // follows "do not modify unrelated files" produces a *correct* patch
    // that still fails `npm test` exit-code on identical pre-existing
    // grounds, and the verifier rejects it with no actionable feedback.
    const baselineExitCode = runTestOnBaseline(workdir, testCmd, baseSha);
    if (
      baselineExitCode !== null &&
      baselineExitCode !== 0 &&
      baselineExitCode === patchedExitCode
    ) {
      return {
        type: 'test_exec',
        description: 'Tests exit non-zero in both baseline and patched (pre-existing failure)',
        required: true,
        passed: true,
        evidence:
          `Baseline (${baseSha.slice(0, 8)}) and patched HEAD both exit ${patchedExitCode} on "${testCmd}"; ` +
          `the failure is pre-existing and not introduced by this step. The plan-generator's "test command must exit 0" ` +
          `criterion still directs the worker to fix tooling blockers — if you see this evidence, the worker chose to scope around the blocker rather than fix it. Reviewers should confirm that decision.`,
      };
    }

    const reasonHeader =
      baselineExitCode === 0
        ? `Baseline (${baseSha.slice(0, 8)}) passes "${testCmd}" but patched HEAD exits ${patchedExitCode} — worker introduced a regression.\n\n`
        : baselineExitCode !== null
          ? `Baseline (${baseSha.slice(0, 8)}) exits ${baselineExitCode}; patched HEAD exits ${patchedExitCode}. Exit codes differ, treating as worker-introduced.\n\n`
          : '';

    return {
      type: 'test_exec',
      description: `Tests failed (${testCmd})`,
      required: true,
      passed: false,
      reason: reasonHeader + last20Lines(output),
    };
  }
}

/**
 * Capture the exit code from a synchronous-execSync rejection. `execSync`
 * throws a value whose `status` property carries the child's exit code
 * (or null when the process was signalled). 1 is the conservative default
 * when status is missing — it lines up with "command failed for an
 * unspecified reason," which is what unknown-status execSync rejections
 * represent in practice.
 */
function readExitCode(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return 1;
}

/**
 * Run `testCmd` against the baseline tree in the worker's worktree, then
 * restore the worker's tree. Returns the exit code on success (including
 * non-zero), or null when the baseline run could not be set up (baseSha
 * unresolvable, checkout failed, or the restore could not complete and
 * we declined to leave the worktree in a half-checked-out state).
 *
 * Mechanism: snapshot the worker's working-tree state with `git stash -u`,
 * overwrite tracked files with `git checkout <baseSha> -- .`, run the
 * test command, restore tracked files back to HEAD, pop the stash. All
 * operations are confined to `workdir`; node_modules and other
 * gitignored content are not perturbed (the same install supports both
 * runs).
 *
 * Conservative on errors: any failure in setup, checkout, or restore
 * returns null and the caller falls back to non-differential semantics.
 * Leaving the worktree intact on failure matters more than reporting a
 * baseline number.
 */
function runTestOnBaseline(
  workdir: string,
  testCmd: string,
  baseSha: string,
): number | null {
  // Resolve baseSha first so we never check out a bogus revision.
  try {
    execSync(`git rev-parse --verify ${baseSha}^{commit}`, {
      cwd: workdir,
      stdio: 'pipe',
    });
  } catch {
    return null;
  }

  // Snapshot the worker's state. `git stash` exits 0 with "No local
  // changes to save" when the tree is clean — fine, we just have nothing
  // to restore later. Untracked content (-u) is included so a worker
  // that wrote a new file but did not commit it survives the round trip.
  let stashCreated: boolean;
  try {
    const stashOutput = execSync(
      'git stash push -u -m swarm-baseline-diff --quiet',
      { cwd: workdir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    // The --quiet flag suppresses stdout on success; we instead use
    // `git stash list` to check whether a stash entry was actually
    // created (clean trees produce no entry).
    stashCreated = stashOutput.length > 0 || hasMatchingStash('swarm-baseline-diff', workdir);
  } catch {
    return null;
  }

  let baselineExitCode: number | null;
  try {
    execSync(`git checkout ${baseSha} -- .`, {
      cwd: workdir,
      stdio: 'pipe',
    });
    try {
      execSync(testCmd, {
        cwd: workdir,
        encoding: 'utf8',
        timeout: DEFAULT_COMMAND_TIMEOUT_MS,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      baselineExitCode = 0;
    } catch (err) {
      baselineExitCode = readExitCode(err);
    }
  } catch {
    baselineExitCode = null;
  } finally {
    // Restore: HEAD-state for tracked files, then pop the stash for any
    // working-tree changes the worker had uncommitted. Both are
    // best-effort; if either fails we still return whatever baseline
    // value we have, but log nothing — the verifier engine logs the
    // surrounding check.
    try {
      execSync('git checkout HEAD -- .', {
        cwd: workdir,
        stdio: 'pipe',
      });
    } catch {
      // Tracked-file restore failed; we may be leaving the tree in a
      // checked-out-to-baseline state. The next verifier check will
      // surface the inconsistency. Returning null disables our own
      // differential pass so we do not credit the worker for a state we
      // cannot prove was preserved.
      baselineExitCode = null;
    }
    if (stashCreated) {
      try {
        execSync('git stash pop --quiet', {
          cwd: workdir,
          stdio: 'pipe',
        });
      } catch {
        // Stash pop conflict — uncommitted changes survive as stash
        // entry `swarm-baseline-diff` and a human can recover them. The
        // baseline number is still valid; we keep it.
      }
    }
  }

  return baselineExitCode;
}

/** Probe `git stash list` for an entry created by {@link runTestOnBaseline}. */
function hasMatchingStash(marker: string, workdir: string): boolean {
  try {
    const list = execSync('git stash list', {
      cwd: workdir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return list.includes(marker);
  } catch {
    return false;
  }
}

function retryTestWithAutoDiscovery(workdir: string): VerificationCheck | null {
  const pkgPath = path.join(workdir, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const testScript: string = pkg.scripts?.test || '';
    if (!/node\s+--test\s+\S+/.test(testScript)) return null;
  } catch {
    return null;
  }

  const fallbackCmd = 'node --test';
  try {
    execSync(fallbackCmd, {
      cwd: workdir,
      encoding: 'utf8',
      timeout: DEFAULT_COMMAND_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return {
      type: 'test_exec',
      description: `Tests passed (${fallbackCmd}, auto-discovery fallback)`,
      required: true,
      passed: true,
      evidence: `Original npm test hit ESM directory bug; retried with "${fallbackCmd}"`,
    };
  } catch {
    return null;
  }
}

function detectBuildCommand(workdir: string): string | null {
  const pkgPath = path.join(workdir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts?.build) return 'npm run build';
    } catch {
      // malformed package.json; skip
    }
  }

  const makefilePath = path.join(workdir, 'Makefile');
  if (fs.existsSync(makefilePath)) {
    const content = fs.readFileSync(makefilePath, 'utf8');
    if (/^build\s*:/m.test(content)) return 'make build';
  }

  return null;
}

function resolvePythonBinary(workdir: string, workingDir: string): string {
  for (const venvDir of ['venv', '.venv', 'env', '.env']) {
    const venvPython = path.join(workdir, venvDir, 'bin', 'python');
    if (fs.existsSync(venvPython)) return venvPython;
  }

  if (workdir !== workingDir) {
    for (const venvDir of ['venv', '.venv', 'env', '.env']) {
      const venvPython = path.join(workingDir, venvDir, 'bin', 'python');
      if (fs.existsSync(venvPython)) return venvPython;
    }
  }

  try {
    execSync('python3 --version', { stdio: 'pipe', timeout: DEFAULT_SIGKILL_DELAY_MS });
    return 'python3';
  } catch {
    return 'python';
  }
}

function detectTestCommand(workdir: string, workingDir: string): string | null {
  const pkgPath = path.join(workdir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const testScript: string = pkg.scripts?.test || '';
      const isPlaceholder = /no test(s)? specified/i.test(testScript)
        || /exit\s+1/.test(testScript) && testScript.includes('echo');
      if (testScript && !isPlaceholder) return 'npm test';
    } catch {
      // malformed package.json; skip
    }
  }

  const makefilePath = path.join(workdir, 'Makefile');
  // pytest is invoked by the verifier, NOT the agent. When the agent runs
  // tests inside its worktree, it does so via its own shell commands; those
  // are transcribed and transcript-parsed by the verifyTests path. This pytest
  // invocation is the outcome-check path, and it must be isolated from
  // orchestrator-generated artifact trees:
  //   - --rootdir="<workdir>" scopes pytest's rootdir search to the repo root
  //     instead of walking up to a common ancestor with parent worktrees (the
  //     shape that caused sympy__sympy-12481 to fail on double-collection of
  //     conftest.py).
  //   - --ignore paths prevent pytest from descending into orchestrator
  //     artifact trees whose own conftest.py would re-register options.
  //     pytest 8.x accepts only paths relative to the current working
  //     directory for --ignore; absolute paths are silently ignored, which
  //     pre-fix caused the parent-worktree conftest to be loaded anyway.
  //     The verifier always invokes pytest with `cwd: workdir`, so the
  //     ignore arguments are intentionally relative.
  const pytestCmd = () => {
    const py = resolvePythonBinary(workdir, workingDir);
    return (
      `${py} -m pytest --rootdir="${workdir}" ` +
      `--ignore=runs --ignore=.swarm`
    );
  };

  const pyprojectPath = path.join(workdir, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    const content = fs.readFileSync(pyprojectPath, 'utf8');
    if (content.includes('[tool.pytest') || content.includes('pytest')) {
      return pytestCmd();
    }
  }

  const setupCfgPath = path.join(workdir, 'setup.cfg');
  if (fs.existsSync(setupCfgPath)) {
    const content = fs.readFileSync(setupCfgPath, 'utf8');
    if (content.includes('[tool:pytest]')) {
      return pytestCmd();
    }
  }

  for (const reqFile of ['requirements.txt', 'requirements-dev.txt', 'requirements-test.txt']) {
    const reqPath = path.join(workdir, reqFile);
    if (fs.existsSync(reqPath)) {
      const content = fs.readFileSync(reqPath, 'utf8');
      if (/^pytest/m.test(content)) {
        return pytestCmd();
      }
    }
  }

  if (fs.existsSync(makefilePath)) {
    const content = fs.readFileSync(makefilePath, 'utf8');
    if (/^test\s*:/m.test(content)) return 'make test';
  }

  for (const testDir of ['tests', 'test']) {
    const testDirPath = path.join(workdir, testDir);
    if (fs.existsSync(testDirPath) && fs.statSync(testDirPath).isDirectory()) {
      try {
        const entries = fs.readdirSync(testDirPath);
        const hasPyTests = entries.some(f => f.startsWith('test_') && f.endsWith('.py'));
        if (hasPyTests) return pytestCmd();
      } catch {
        // unreadable dir; skip
      }
    }
  }

  return null;
}

function extractCommandOutput(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const parts: string[] = [];
    if (e.stdout) parts.push(e.stdout);
    if (e.stderr) parts.push(e.stderr);
    if (parts.length > 0) return parts.join('\n');
    if (e.message) return e.message;
  }
  return String(err);
}

