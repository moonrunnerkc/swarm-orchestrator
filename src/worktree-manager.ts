import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_BRANCH_SWITCH_TIMEOUT_MS } from './defaults';
import { getLogger } from './logger';
const logger = getLogger('worktree-manager');

/**
 * Manages git worktrees, branches, and initial repo setup for parallel agent isolation.
 * Extracted from SwarmOrchestrator to keep git operations in a single focused module.
 */
export class WorktreeManager {
  constructor(private workingDir: string) {}

  /**
   * Create an isolated git worktree for a step's agent to work in.
   * When repoDir differs from workingDir, the worktree forks from
   * the target repo's history (e.g. bootstrap targeting an external project).
   */
  async createAgentWorktree(
    branchName: string,
    fromBranch: string,
    runDir: string,
    stepNumber: number,
    repoDir?: string
  ): Promise<string> {
    let gitDir = repoDir || this.workingDir;
    const worktreePath = path.join(runDir, 'worktrees', `step-${stepNumber}`);

    const worktreesDir = path.dirname(worktreePath);
    if (!fs.existsSync(worktreesDir)) {
      fs.mkdirSync(worktreesDir, { recursive: true });
    }

    // Guard: verify the resolved git root matches the intended target directory.
    // Without this, a parent repo (e.g. /home/user/.git) silently captures all
    // git operations and worktrees fork from the wrong history.
    gitDir = this.ensureOwnGitRepo(gitDir);

    // Ensure the target repo has at least one commit (handles freshly-init'd repos)
    try {
      execSync('git rev-parse HEAD', { cwd: gitDir, stdio: 'pipe' });
    } catch {
      try {
        execSync('git add -A', { cwd: gitDir, stdio: 'pipe' });
        execSync('git commit --allow-empty -m "chore: initialize repository"', { cwd: gitDir, stdio: 'pipe' });
      } catch {
        try {
          execSync('git commit --allow-empty -m "chore: initialize repository"', { cwd: gitDir, stdio: 'pipe' });
        } catch {
          // Truly cannot commit; worktree add will fail with a clear error
        }
      }
    }

    // Resolve fromBranch: the target repo may not have the same branch name.
    // Also handle detached-HEAD repos (SWE-bench checks out a specific commit).
    let resolvedFromBranch = fromBranch;
    try {
      const targetBranch = execSync('git branch --show-current', { cwd: gitDir, encoding: 'utf8', stdio: 'pipe' }).trim();
      if (targetBranch) {
        resolvedFromBranch = targetBranch;
      } else {
        // Detached HEAD — use the commit SHA directly as the start point.
        // `git rev-parse --abbrev-ref HEAD` returns literal "HEAD" in detached state,
        // which is valid as a start point, but using the full SHA is more explicit.
        resolvedFromBranch = execSync('git rev-parse HEAD', { cwd: gitDir, encoding: 'utf8', stdio: 'pipe' }).trim();
      }
    } catch {
      // Keep the original fromBranch as best-effort fallback
    }

    // Create the branch without checkout
    try {
      execSync(`git branch ${branchName} ${resolvedFromBranch}`, { cwd: gitDir, stdio: 'pipe' });
    } catch {
      // Branch already exists from a prior retry; safe to reuse
    }

    // Clean up existing worktree if present (e.g. from a retry)
    if (fs.existsSync(worktreePath)) {
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, { cwd: gitDir, stdio: 'pipe' });
      } catch {
        try {
          execSync('git worktree prune', { cwd: gitDir, stdio: 'pipe' });
        } catch {
          // Prune is best-effort cleanup
        }
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    return new Promise((resolve, reject) => {
      const proc = spawn('git', ['worktree', 'add', worktreePath, branchName], {
        cwd: gitDir
      });

      let stderr = '';
      if (proc.stderr) {
        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      }

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(worktreePath);
        } else {
          reject(new Error(`Failed to create worktree for step ${stepNumber}: ${stderr}`));
        }
      });
    });
  }

  /**
   * Remove a git worktree. Non-throwing: always resolves even on failure
   * since worktree cleanup is best-effort post-merge.
   */
  async removeAgentWorktree(worktreePath: string): Promise<void> {
    return new Promise((resolve) => {
      const proc = spawn('git', ['worktree', 'remove', worktreePath, '--force'], {
        cwd: this.workingDir
      });

      proc.on('close', () => {
        resolve();
      });
    });
  }

  /**
   * Create a new git branch (legacy path; kept for replan retry branches).
   * Stashes uncommitted changes before switching to avoid conflicts from
   * parallel agents.
   */
  async createAgentBranch(branchName: string, fromBranch: string): Promise<void> {
    try {
      execSync('git stash --include-untracked', { cwd: this.workingDir, stdio: 'pipe' });
    } catch {
      // Stash fails when working tree is clean; expected during normal execution
    }

    return new Promise((resolve, reject) => {
      const proc = spawn('git', ['checkout', '-b', branchName, fromBranch], {
        cwd: this.workingDir
      });

      let stderr = '';
      if (proc.stderr) {
        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      }

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to create branch ${branchName}: ${stderr}`));
        }
      });
    });
  }

  /**
   * Switch to a git branch with a 15s timeout safety net.
   */
  async switchBranch(branchName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', ['checkout', branchName], {
        cwd: this.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      });

      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`Timeout switching to branch ${branchName}`));
      }, DEFAULT_BRANCH_SWITCH_TIMEOUT_MS);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to switch to branch ${branchName}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  getCurrentBranch(): string {
    const result = execSync('git branch --show-current', {
      cwd: this.workingDir,
      encoding: 'utf8'
    });
    return result.trim() || 'main';
  }

  /**
   * Ensure repo has at least one commit (required for branch creation).
   * Creates an initial commit with a .gitignore if repo is empty.
   * Also verifies the working directory is its own git root first.
   */
  ensureInitialCommit(): void {
    // Validate git root before any operations; prevents silently
    // committing into a parent repo like /home/user/.git
    this.ensureOwnGitRepo(this.workingDir);

    try {
      execSync('git rev-parse HEAD', {
        cwd: this.workingDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return;
    } catch {
      // rev-parse fails when repo has no commits; fall through to create one
    }

    logger.info('  \u{1F4DD} Empty repo detected, creating initial commit...');

    const gitignorePath = path.join(this.workingDir, '.gitignore');

    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, `# Swarm orchestrator artifacts
plans/
runs/
proof/
.quickfix/
.context/
.locks/
node_modules/
`);
    }

    try {
      execSync('git add .gitignore', { cwd: this.workingDir, stdio: 'pipe' });
      execSync('git commit -m "chore: initialize repository"', { cwd: this.workingDir, stdio: 'pipe' });
      logger.info('  \u2705 Initial commit created');
    } catch {
      try {
        execSync('git add -A', { cwd: this.workingDir, stdio: 'pipe' });
        execSync('git commit --allow-empty -m "chore: initialize repository"', { cwd: this.workingDir, stdio: 'pipe' });
        logger.info('  \u2705 Initial commit created (empty)');
      } catch (innerErr: unknown) {
        const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
        logger.warn(`[init] Could not create initial commit: ${msg}`);
      }
    }
  }

  /**
   * Verify that targetDir is its own git repository root, not a subdirectory
   * of a parent repo. If git resolves to a different root (e.g. /home/user),
   * initialize a dedicated repo at targetDir so worktrees fork from the
   * correct history instead of the parent's.
   */
  ensureOwnGitRepo(targetDir: string): string {
    const resolved = path.resolve(targetDir);

    try {
      const gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: resolved, encoding: 'utf8', stdio: 'pipe'
      }).trim();

      if (path.resolve(gitRoot) === resolved) {
        return resolved;
      }

      // Git resolved to a parent directory; targetDir is not its own repo.
      // Initialize a fresh repo so worktrees use the right history.
      logger.info(`  ⚠️  ${resolved} is inside parent repo ${gitRoot}; initializing dedicated git repo`);
    } catch {
      // No git repo found at all; initialize one
      logger.info(`  📂 No git repo at ${resolved}; initializing`);
    }

    execSync('git init', { cwd: resolved, stdio: 'pipe' });
    execSync('git config user.email "swarm-orchestrator@local"', { cwd: resolved, stdio: 'pipe' });
    execSync('git config user.name "Swarm Orchestrator"', { cwd: resolved, stdio: 'pipe' });
    execSync('git add -A', { cwd: resolved, stdio: 'pipe' });
    try {
      execSync('git commit -m "initialize project for swarm orchestration"', {
        cwd: resolved, stdio: 'pipe',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      });
    } catch {
      execSync('git commit --allow-empty -m "initialize project for swarm orchestration"', {
        cwd: resolved, stdio: 'pipe',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      });
    }

    return resolved;
  }
}

export default WorktreeManager;
