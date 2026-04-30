import { strict as assert } from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkGitDiff } from '../../src/verifier/outcome-checks';

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
