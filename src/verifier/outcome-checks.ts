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
import { gitPathspecExcludes } from '../worktree-reserved-paths';

function last20Lines(output: string): string {
  const lines = output.split('\n');
  if (lines.length <= 20) return output;
  return '...\n' + lines.slice(-20).join('\n');
}

export function runOutcomeChecks(
  opts: OutcomeVerificationOpts,
  workingDir: string
): VerificationCheck[] {
  const checks: VerificationCheck[] = [];

  checks.push(checkGitDiff(opts.workdir, opts.baseSha));

  if (opts.expectedFiles && opts.expectedFiles.length > 0) {
    checks.push(checkFileExistence(opts.workdir, opts.expectedFiles));
  }

  const buildCheck = checkBuildExec(opts.workdir);
  if (buildCheck) {
    checks.push(buildCheck);
  }

  if (process.env.SWARM_SKIP_OUTCOME_TEST_EXEC !== '1') {
    const testCheck = checkTestExec(opts.workdir, workingDir);
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

function checkTestExec(workdir: string, workingDir: string): VerificationCheck | null {
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

    if (testCmd === 'npm test' && output.includes('MODULE_NOT_FOUND')) {
      const fallback = retryTestWithAutoDiscovery(workdir);
      if (fallback) return fallback;
    }

    return {
      type: 'test_exec',
      description: `Tests failed (${testCmd})`,
      required: true,
      passed: false,
      reason: last20Lines(output),
    };
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
  const pytestCmd = () => {
    const py = resolvePythonBinary(workdir, workingDir);
    const runsDir = path.join(workdir, 'runs');
    const swarmDir = path.join(workdir, '.swarm');
    return (
      `${py} -m pytest --rootdir="${workdir}" ` +
      `--ignore="${runsDir}" --ignore="${swarmDir}"`
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

