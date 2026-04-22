// Author: Bradley R. Kinnard
import { strict as assert } from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gitPathspecExcludes } from '../src/worktree-reserved-paths';

/**
 * Create a temp git repo with both real files and files inside every reserved
 * path category. Used by both the "bare add leaks" and "fixed add cleans" tests.
 */
function buildTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-commit-test-'));

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@test.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@test.com',
    GIT_TERMINAL_PROMPT: '0',
  };

  execSync('git init', { cwd: dir, stdio: 'pipe', env: gitEnv });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe', env: gitEnv });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe', env: gitEnv });

  // Create real source file — this SHOULD appear in every commit
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'real.ts'), 'export const x = 1;\n');

  // Reserved: orchestrator runtime directories
  fs.mkdirSync(path.join(dir, 'runs', 'swarm-abc'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'runs', 'swarm-abc', 'session-state.json'),
    JSON.stringify({ runId: 'swarm-abc' })
  );

  fs.mkdirSync(path.join(dir, '.quickfix'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.quickfix', 'state.json'), '{}');

  fs.mkdirSync(path.join(dir, 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'plans', 'plan-001.json'), '{}');

  // Reserved: build artifacts
  fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {};\n');

  fs.mkdirSync(path.join(dir, '__pycache__'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '__pycache__', 'foo.cpython-311.pyc'),
    '# compiled python\n'
  );

  fs.mkdirSync(path.join(dir, '.venv', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.venv', 'bin', 'python'), '#!/bin/sh\n');

  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'bundle.js'), 'bundled\n');

  fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'coverage', 'lcov.info'), 'coverage data\n');

  // Reserved: file-glob patterns — Python 3 puts .pyc in __pycache__ (already
  // excluded above as a directory), but any stray .pyc in a subdirectory should
  // also be suppressed. Root-level .pyc files are Python 2 artifacts and are not
  // covered by **/*.pyc on all git versions; that edge case is out of scope.
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'lib', 'util.pyc'), '# pyc in subdir\n');

  // Create initial commit so HEAD exists (required for git add -A to work)
  fs.writeFileSync(path.join(dir, '.gitignore'), '# placeholder\n');
  execSync('git add .gitignore', { cwd: dir, stdio: 'pipe', env: gitEnv });
  execSync('git commit -m "chore: init"', { cwd: dir, stdio: 'pipe', env: gitEnv });

  return dir;
}

/**
 * Return the list of files present in the most recent commit of the repo.
 */
function filesInLastCommit(dir: string): string[] {
  const out = execSync('git diff-tree --no-commit-id -r --name-only HEAD', {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
  return out ? out.split('\n') : [];
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; test result is already recorded
  }
}

describe('commit-level reserved-path exclusion: behavioral', () => {
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@test.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@test.com',
    GIT_TERMINAL_PROMPT: '0',
  };

  it('bare git add -A leaks reserved paths into the commit (documents the bug)', () => {
    const dir = buildTempRepo();
    try {
      execSync('git add -A', { cwd: dir, stdio: 'pipe', env: gitEnv });
      execSync('git commit -m "auto: bare add"', { cwd: dir, stdio: 'pipe', env: gitEnv });

      const files = filesInLastCommit(dir);

      // Reserved paths SHOULD be present (this is the leak we're fixing)
      const leakedReserved = files.filter(f =>
        f.startsWith('runs/') ||
        f.startsWith('.quickfix/') ||
        f.startsWith('plans/') ||
        f.startsWith('node_modules/') ||
        f.startsWith('__pycache__/') ||
        f.startsWith('.venv/') ||
        f.startsWith('dist/') ||
        f.startsWith('coverage/') ||
        f.endsWith('.pyc') && !f.startsWith('__pycache__/')
      );

      assert.ok(
        leakedReserved.length > 0,
        `Expected bare git add -A to commit reserved-path files (leak), but none leaked.\n` +
        `Files in commit: ${JSON.stringify(files)}`
      );
    } finally {
      cleanup(dir);
    }
  });

  it('git add -A with gitPathspecExcludes() omits all reserved paths from the commit', () => {
    const dir = buildTempRepo();
    try {
      const excludes = gitPathspecExcludes();
      // git add -A requires a positive pathspec when excludes are present.
      // We use '.' as the positive pathspec alongside the :(exclude) directives.
      execSync(
        `git add -A -- . ${excludes.map(e => `'${e}'`).join(' ')}`,
        { cwd: dir, stdio: 'pipe', env: gitEnv }
      );
      execSync('git commit -m "auto: excluded add"', { cwd: dir, stdio: 'pipe', env: gitEnv });

      const files = filesInLastCommit(dir);

      // src/real.ts MUST be committed
      assert.ok(
        files.includes('src/real.ts'),
        `Expected src/real.ts in commit. Files: ${JSON.stringify(files)}`
      );

      // None of the reserved-path files should appear
      const leaked = files.filter(f =>
        f.startsWith('runs/') ||
        f.startsWith('.quickfix/') ||
        f.startsWith('plans/') ||
        f.startsWith('node_modules/') ||
        f.startsWith('__pycache__/') ||
        f.startsWith('.venv/') ||
        f.startsWith('dist/') ||
        f.startsWith('coverage/') ||
        f.endsWith('.pyc')
      );

      assert.strictEqual(
        leaked.length,
        0,
        `Reserved-path files leaked into commit:\n  ${leaked.join('\n  ')}`
      );
    } finally {
      cleanup(dir);
    }
  });
});
