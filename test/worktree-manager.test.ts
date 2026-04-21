import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { WorktreeManager } from '../src/worktree-manager';

describe('WorktreeManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-mgr-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('ensureOwnGitRepo', () => {
    it('returns the directory unchanged when it is already a git root', () => {
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git commit --allow-empty -m "init"', {
        cwd: tempDir, stdio: 'pipe',
        env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@test.com',
               GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@test.com' }
      });

      const manager = new WorktreeManager(tempDir);
      const result = manager.ensureOwnGitRepo(tempDir);
      assert.strictEqual(path.resolve(result), path.resolve(tempDir));
    });

    it('initializes a git repo when the directory has no git at all', () => {
      const subDir = path.join(tempDir, 'no-git-project');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'file.txt'), 'content');

      // Ensure tempDir itself is NOT a git repo so subDir has nothing to inherit
      const manager = new WorktreeManager(subDir);
      const result = manager.ensureOwnGitRepo(subDir);

      assert.strictEqual(path.resolve(result), path.resolve(subDir));

      // Verify .git was created
      assert.ok(fs.existsSync(path.join(subDir, '.git')), 'should have .git directory');

      // Verify the resolved git root is the subDir, not a parent
      const gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: subDir, encoding: 'utf8', stdio: 'pipe'
      }).trim();
      assert.strictEqual(path.resolve(gitRoot), path.resolve(subDir));
    });

    it('initializes a new repo when directory is inside a parent repo', () => {
      // Create parent repo
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git commit --allow-empty -m "parent init"', {
        cwd: tempDir, stdio: 'pipe',
        env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@test.com',
               GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@test.com' }
      });

      // Create subdirectory (no .git of its own)
      const childDir = path.join(tempDir, 'projects', 'my-app');
      fs.mkdirSync(childDir, { recursive: true });
      fs.writeFileSync(path.join(childDir, 'app.py'), 'print("hello")');

      // Before fix: git would resolve to parent. After fix: gets its own repo.
      const manager = new WorktreeManager(childDir);
      const result = manager.ensureOwnGitRepo(childDir);

      assert.strictEqual(path.resolve(result), path.resolve(childDir));

      // The child directory now has its own .git
      assert.ok(fs.existsSync(path.join(childDir, '.git')), 'child should have its own .git');

      // git root from within child should resolve to child, not parent
      const gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: childDir, encoding: 'utf8', stdio: 'pipe'
      }).trim();
      assert.strictEqual(path.resolve(gitRoot), path.resolve(childDir));

      // Parent repo should still resolve to parent
      const parentRoot = execSync('git rev-parse --show-toplevel', {
        cwd: tempDir, encoding: 'utf8', stdio: 'pipe'
      }).trim();
      assert.strictEqual(path.resolve(parentRoot), path.resolve(tempDir));
    });

    it('commits existing files when initializing a subdirectory repo', () => {
      // Create parent repo
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git commit --allow-empty -m "parent init"', {
        cwd: tempDir, stdio: 'pipe',
        env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@test.com',
               GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@test.com' }
      });

      const childDir = path.join(tempDir, 'child');
      fs.mkdirSync(childDir);
      fs.writeFileSync(path.join(childDir, 'main.py'), 'print("hi")');
      fs.writeFileSync(path.join(childDir, 'README.md'), '# Child');

      const manager = new WorktreeManager(childDir);
      manager.ensureOwnGitRepo(childDir);

      // Files should be committed (not just init'd empty)
      const log = execSync('git log --oneline', {
        cwd: childDir, encoding: 'utf8', stdio: 'pipe'
      }).trim();
      assert.ok(log.length > 0, 'should have at least one commit');

      const tracked = execSync('git ls-files', {
        cwd: childDir, encoding: 'utf8', stdio: 'pipe'
      }).trim();
      assert.ok(tracked.includes('main.py'), 'main.py should be tracked');
      assert.ok(tracked.includes('README.md'), 'README.md should be tracked');
    });
  });

  describe('resolveDefaultBranch', () => {
    const GIT_ENV = {
      ...process.env,
      GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@test.com',
      GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@test.com',
    };

    function initRepoWithUpstream(dir: string, initialBranch: string): string {
      // Build a bare repo that acts as `origin`, with HEAD pointed at initialBranch.
      const origin = path.join(dir, 'origin.git');
      fs.mkdirSync(origin);
      execSync(`git init --bare -b ${initialBranch} "${origin}"`, { stdio: 'pipe' });

      // Seed the bare repo by pushing one commit from a disposable working copy.
      const seed = path.join(dir, 'seed');
      execSync(`git init -b ${initialBranch} "${seed}"`, { stdio: 'pipe' });
      fs.writeFileSync(path.join(seed, 'seed.txt'), 'seed');
      execSync('git add . && git commit -m seed',
        { cwd: seed, stdio: 'pipe', env: GIT_ENV });
      execSync(`git remote add origin "${origin}"`, { cwd: seed, stdio: 'pipe' });
      execSync(`git push -u origin ${initialBranch}`, { cwd: seed, stdio: 'pipe' });

      // Clone into the working copy the test will operate on.
      const work = path.join(dir, 'work');
      execSync(`git clone "${origin}" "${work}"`, { stdio: 'pipe' });
      execSync(`git remote set-head origin ${initialBranch}`,
        { cwd: work, stdio: 'pipe' });
      return work;
    }

    it('returns the upstream default when origin/HEAD resolves to master', () => {
      const work = initRepoWithUpstream(tempDir, 'master');
      const manager = new WorktreeManager(work);
      assert.strictEqual(manager.resolveDefaultBranch(), 'master');
    });

    it('returns the upstream default when origin/HEAD resolves to main', () => {
      const work = initRepoWithUpstream(tempDir, 'main');
      const manager = new WorktreeManager(work);
      assert.strictEqual(manager.resolveDefaultBranch(), 'main');
    });

    it('still works on a detached HEAD checkout of a master-default repo', () => {
      // SWE-bench harness behavior: clone, then checkout a specific commit,
      // which puts HEAD in detached state. `git branch --show-current` returns
      // empty in this state; the old fallback would have returned "main"
      // (wrong for master repos). The new resolver must catch this via
      // origin/HEAD regardless.
      const work = initRepoWithUpstream(tempDir, 'master');
      const sha = execSync('git rev-parse HEAD', { cwd: work, encoding: 'utf8' }).trim();
      execSync(`git checkout --detach ${sha}`, { cwd: work, stdio: 'pipe' });

      const current = execSync('git branch --show-current',
        { cwd: work, encoding: 'utf8' }).trim();
      assert.strictEqual(current, '', 'precondition: HEAD is detached');

      const manager = new WorktreeManager(work);
      assert.strictEqual(manager.resolveDefaultBranch(), 'master',
        'detached-HEAD master repos must resolve via origin/HEAD, not the literal "main"');
    });

    it('falls back to the current branch when origin/HEAD is unset', () => {
      execSync(`git init -b trunk "${tempDir}"`, { stdio: 'pipe' });
      fs.writeFileSync(path.join(tempDir, 'x.txt'), '');
      execSync('git add . && git commit -m init',
        { cwd: tempDir, stdio: 'pipe', env: GIT_ENV });

      const manager = new WorktreeManager(tempDir);
      assert.strictEqual(manager.resolveDefaultBranch(), 'trunk');
    });

    it('falls back to "main" for an empty repo with no commits and no remote', () => {
      execSync(`git init "${tempDir}"`, { stdio: 'pipe' });
      const manager = new WorktreeManager(tempDir);
      // init branch name is whatever git's init.defaultBranch is; on modern git
      // it's usually "main" or "master". Either way, resolveDefaultBranch
      // should return *some* non-empty string, not blow up.
      const resolved = manager.resolveDefaultBranch();
      assert.ok(resolved.length > 0, 'must return a non-empty branch name');
    });
  });
});
