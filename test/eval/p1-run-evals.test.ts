import { strict as assert } from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DRIVER_PATH = path.join(REPO_ROOT, 'scripts', 'eval', 'p1-run-evals.py');

function gitInit(repoPath: string): void {
  const opts = { cwd: repoPath, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'] };
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], opts);
  execFileSync('git', ['config', 'user.email', 'eval@test'], opts);
  execFileSync('git', ['config', 'user.name', 'eval'], opts);
}

function gitCommit(repoPath: string, message: string): string {
  const opts = { cwd: repoPath, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'] };
  execFileSync('git', ['add', '-A'], opts);
  execFileSync('git', ['commit', '--quiet', '-m', message], opts);
  return execFileSync('git', ['rev-parse', 'HEAD'], { ...opts, encoding: 'utf8' }).trim();
}

/**
 * Invoke materialize_gold_branch from p1-run-evals.py against `repoPath` with
 * `patchText` as the gold patch. Returns the (string) result printed by the
 * function (the gold branch name on success, empty string on failure).
 *
 * We import the driver via importlib because the filename contains a hyphen.
 */
function callMaterializeGoldBranch(repoPath: string, patchText: string): { status: number; stdout: string; stderr: string } {
  const patchFile = path.join(os.tmpdir(), `p1-eval-patch-${Date.now()}-${process.pid}.diff`);
  fs.writeFileSync(patchFile, patchText, 'utf8');
  try {
    const code = [
      'import importlib.util, pathlib, sys',
      `spec = importlib.util.spec_from_file_location('p1eval', ${JSON.stringify(DRIVER_PATH)})`,
      'mod = importlib.util.module_from_spec(spec)',
      // Register the module in sys.modules before exec so @dataclass can
      // resolve `cls.__module__` at decoration time. Without this, the
      // `@dataclass class InstancePrepResult` decorator at module top-level
      // raises AttributeError on Python 3.12.
      "sys.modules['p1eval'] = mod",
      'spec.loader.exec_module(mod)',
      `repo = pathlib.Path(${JSON.stringify(repoPath)})`,
      `patch_text = open(${JSON.stringify(patchFile)}, 'r', encoding='utf-8').read()`,
      'result = mod.materialize_gold_branch(repo, patch_text)',
      "sys.stdout.write(result if result else '')",
    ].join('\n');
    const r = spawnSync('python3', ['-c', code], { encoding: 'utf8', timeout: 30_000 });
    return {
      status: r.status ?? 1,
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? '',
    };
  } finally {
    fs.rmSync(patchFile, { force: true });
  }
}

describe('p1-run-evals.materialize_gold_branch', () => {
  let cleanup: string[] = [];

  afterEach(() => {
    for (const dir of cleanup) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    cleanup = [];
  });

  it('does not commit untracked .venv files to the gold branch (round-5 regression)', () => {
    // Round-5 root cause: setup_venv() populated .venv/ before
    // materialize_gold_branch() ran; the old `git add -A` shape staged the
    // entire untracked corpus alongside the gold patch. After the final
    // checkout --detach <base>, the venv binaries were deleted from the
    // working tree because the base commit didn't carry them. The next
    // synth-eval test invocation exited 127 with `python: command not
    // found`. The fix swaps in `git apply --index`, which stages exactly
    // the patch's diff and never scans untracked files.
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'p1eval-mgb-'));
    cleanup.push(repo);

    gitInit(repo);
    fs.writeFileSync(path.join(repo, 'README.md'), 'base\n', 'utf8');
    gitCommit(repo, 'base');

    // Detach so the function's `git rev-parse HEAD` matches the production
    // shape (the prep flow detaches at base_commit before this function
    // runs).
    execFileSync('git', ['checkout', '--quiet', '--detach', 'HEAD'], {
      cwd: repo,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Simulate setup_venv()'s output: an untracked .venv/ tree containing a
    // python3 binary. The scenario that broke production: this binary
    // lives outside any tracked path on the base branch.
    const venvBin = path.join(repo, '.venv', 'bin');
    fs.mkdirSync(venvBin, { recursive: true });
    const pythonBinary = path.join(venvBin, 'python3');
    fs.writeFileSync(pythonBinary, '#!/bin/sh\necho fake-venv-python\n', 'utf8');
    fs.chmodSync(pythonBinary, 0o755);
    fs.writeFileSync(path.join(venvBin, 'pip'), '#!/bin/sh\necho fake-pip\n', 'utf8');
    fs.chmodSync(path.join(venvBin, 'pip'), 0o755);

    // Minimal valid unified-diff patch that touches only README.md, the
    // single tracked file. The gold-branch commit must contain exactly
    // this change and nothing from .venv/.
    const patch = [
      'diff --git a/README.md b/README.md',
      'index 0000000..1111111 100644',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1 +1,2 @@',
      ' base',
      '+gold-line',
      '',
    ].join('\n');

    const result = callMaterializeGoldBranch(repo, patch);
    assert.equal(result.status, 0,
      `python invocation failed:\nstatus=${result.status}\nstderr=${result.stderr}`);
    assert.equal(result.stdout, 'swarm-gold-eval',
      `expected gold-branch name; got stdout=${JSON.stringify(result.stdout)}`);

    // Round-5 assertion: the venv binary must still be on disk after the
    // function's final `git checkout --detach <head>` step.
    assert.ok(fs.existsSync(pythonBinary),
      `.venv/bin/python3 must survive gold-branch checkout; was deleted`);
    assert.ok(fs.existsSync(path.join(venvBin, 'pip')),
      `.venv/bin/pip must survive gold-branch checkout; was deleted`);

    // The gold branch must contain exactly README.md's diff. Listing the
    // branch tree must NOT include .venv/.
    const tree = execFileSync('git', ['ls-tree', '-r', '--name-only', 'swarm-gold-eval'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim().split('\n').sort();
    assert.deepEqual(tree, ['README.md'],
      `gold branch tree must contain only README.md; got ${JSON.stringify(tree)}`);

    // The gold-branch commit must reflect the patch's content change.
    const goldReadme = execFileSync('git', ['show', 'swarm-gold-eval:README.md'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(goldReadme, 'base\ngold-line\n');
  });

  it('returns None when the gold patch fails to apply', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'p1eval-mgb-bad-'));
    cleanup.push(repo);
    gitInit(repo);
    fs.writeFileSync(path.join(repo, 'README.md'), 'base\n', 'utf8');
    gitCommit(repo, 'base');
    execFileSync('git', ['checkout', '--quiet', '--detach', 'HEAD'], {
      cwd: repo,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Patch context references a line ('zzz') that does not exist; apply
    // must fail and the function must return None.
    const badPatch = [
      'diff --git a/README.md b/README.md',
      'index 0000000..1111111 100644',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1 +1,2 @@',
      ' zzz',
      '+gold-line',
      '',
    ].join('\n');

    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    const result = callMaterializeGoldBranch(repo, badPatch);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '', 'failed apply must return None (stdout empty)');

    // The branch may exist (the function does `git checkout -B GOLD_BRANCH`
    // before attempting the apply) but its tip must still be at the base
    // commit — no `[p1-eval] gold patch` commit was made on top.
    const branches = execFileSync('git', ['branch', '--list', 'swarm-gold-eval'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (branches.trim() !== '') {
      const goldTip = execFileSync('git', ['rev-parse', 'swarm-gold-eval'], {
        cwd: repo,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      assert.equal(goldTip, baseSha,
        'gold branch tip must remain at base after a failed apply (no patch commit on top)');
    }

    // Working tree must be back at base, not on the gold branch.
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    assert.equal(head, baseSha, 'HEAD must be detached at base after a failed apply');
  });
});
