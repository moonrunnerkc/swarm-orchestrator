import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_CONTEXT_LOCK_WAIT_MS,
  DEFAULT_CONTEXT_STALE_LOCK_MS,
  DEFAULT_DEPENDENCY_WAIT_MS,
  DEFAULT_SIGKILL_DELAY_MS,
} from './defaults';
import { getLogger } from './logger';
const logger = getLogger('context-broker');

/**
 * Shared context entry for cross-agent communication
 */
export interface ContextEntry {
  stepNumber: number;
  agentName: string;
  timestamp: string;
  data: {
    filesChanged: string[];
    outputsSummary: string;
    branchName?: string;
    commitShas?: string[];
    verificationPassed?: boolean;
    transcript?: string; // path to share.md transcript file
  };
}

/**
 * Git lock for safe concurrent operations
 */
interface GitLock {
  lockId: string;
  agentName: string;
  operation: string;
  acquiredAt: string;
}

/**
 * Context Broker - manages shared state and git locking for parallel agents
 * Uses EventEmitter for zero-latency dependency notification instead of file polling
 */
export class ContextBroker extends EventEmitter {
  private contextDir: string;
  private lockDir: string;
  private contextFile: string;
  private maxLockWaitMs: number = DEFAULT_CONTEXT_LOCK_WAIT_MS;

  constructor(runDir: string) {
    super();
    // Plans with many steps create concurrent per-step listeners for dependency tracking
    this.setMaxListeners(50);
    this.contextDir = path.join(runDir, '.context');
    this.lockDir = path.join(runDir, '.locks');
    this.contextFile = path.join(this.contextDir, 'shared-context.json');

    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.contextDir)) {
      fs.mkdirSync(this.contextDir, { recursive: true });
    }
    if (!fs.existsSync(this.lockDir)) {
      fs.mkdirSync(this.lockDir, { recursive: true });
    }
  }

  /**
   * Acquire a git lock for safe concurrent operations
   * Returns lock ID if successful, null if timeout
   */
  async acquireGitLock(
    agentName: string,
    operation: string
  ): Promise<string | null> {
    const lockId = randomBytes(16).toString('hex');
    const lockFile = path.join(this.lockDir, 'git.lock');

    const lock: GitLock = {
      lockId,
      agentName,
      operation,
      acquiredAt: new Date().toISOString()
    };

    const startTime = Date.now();

    // spin-wait for lock with timeout
    while (Date.now() - startTime < this.maxLockWaitMs) {
      // Re-ensure lock directory exists (may have been removed by rollback/cleanup)
      if (!fs.existsSync(this.lockDir)) {
        fs.mkdirSync(this.lockDir, { recursive: true });
      }
      try {
        // atomic file creation (fails if exists)
        fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2), { flag: 'wx' });
        return lockId;
      } catch (err: unknown) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'ENOENT') {
          // Directory was removed between check and write, retry
          fs.mkdirSync(this.lockDir, { recursive: true });
          continue;
        }
        if (error.code === 'EEXIST') {
          // lock exists, check if stale (> 5 minutes old)
          try {
            const existingLock = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as GitLock;
            const lockAge = Date.now() - new Date(existingLock.acquiredAt).getTime();

            if (lockAge > DEFAULT_CONTEXT_STALE_LOCK_MS) {
              // stale lock, force remove
              fs.unlinkSync(lockFile);
              continue;
            }
          } catch {
            // Lock file contains invalid JSON (corrupted write); safe to remove and retry
            fs.unlinkSync(lockFile);
            continue;
          }

          // wait and retry
          await this.sleep(100);
          continue;
        }
        throw error;
      }
    }

    return null; // timeout
  }

  /**
   * Release a git lock
   */
  releaseGitLock(lockId: string): void {
    const lockFile = path.join(this.lockDir, 'git.lock');

    try {
      const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as GitLock;

      if (lock.lockId === lockId) {
        fs.unlinkSync(lockFile);
      } else {
        logger.warn(`Lock mismatch: expected ${lockId}, got ${lock.lockId}`);
      }
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        logger.error('Failed to release lock:', error);
      }
    }
  }

  /**
   * Force-remove all lock files regardless of age.
   * Use before critical phases (e.g. final merge) to clear stale locks
   * from cancelled runs.
   */
  forceReleaseStaleLocks(): void {
    // Re-ensure lock directory exists (may have been removed by rollback/cleanup)
    if (!fs.existsSync(this.lockDir)) {
      fs.mkdirSync(this.lockDir, { recursive: true });
    }
    const lockFile = path.join(this.lockDir, 'git.lock');
    try {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
      }
    } catch {
      // Lock file may have been removed by a concurrent release; harmless
    }
  }

  /**
   * Add context from a completed step.
   * Uses an exclusive file lock around the read-modify-write to prevent
   * concurrent writers from losing entries. In single-process Node.js the
   * synchronous I/O already serializes, but the lock protects against
   * future multi-process architectures.
   */
  addStepContext(entry: ContextEntry): void {
    this.ensureDirectories();

    const lockFile = path.join(this.lockDir, 'context.lock');
    this.acquireFileLockSync(lockFile);
    try {
      const contexts = this.getAllContext();
      contexts.push(entry);
      fs.writeFileSync(
        this.contextFile,
        JSON.stringify(contexts, null, 2),
        'utf8'
      );
    } finally {
      this.releaseFileLockSync(lockFile);
    }

    this.emit('step-completed', entry.stepNumber);
  }

  /**
   * Synchronous exclusive file lock via atomic wx creation.
   * Stale locks (>5s) are force-removed on retry.
   */
  private acquireFileLockSync(lockFile: string): void {
    const maxAttempts = 50;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        fs.writeFileSync(
          lockFile,
          JSON.stringify({ pid: process.pid, ts: Date.now() }),
          { flag: 'wx' }
        );
        return;
      } catch (err: unknown) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'EEXIST') {
          try {
            const stat = fs.statSync(lockFile);
            if (Date.now() - stat.mtimeMs > DEFAULT_SIGKILL_DELAY_MS) {
              fs.unlinkSync(lockFile);
              continue;
            }
          } catch {
            // Lock removed between check and stat; retry
            continue;
          }
          // Single-process Node.js: synchronous ops cannot interleave,
          // so this continue only fires in multi-process scenarios
          continue;
        }
        if (error.code === 'ENOENT') {
          this.ensureDirectories();
          continue;
        }
        throw error;
      }
    }
    throw new Error(
      `Failed to acquire context lock after ${maxAttempts} attempts: ${lockFile}`
    );
  }

  private releaseFileLockSync(lockFile: string): void {
    try {
      fs.unlinkSync(lockFile);
    } catch {
      // Lock file already removed or directory cleaned; harmless
    }
  }

  /**
   * Get all shared context entries
   */
  getAllContext(): ContextEntry[] {
    if (!fs.existsSync(this.contextFile)) {
      return [];
    }

    try {
      const content = fs.readFileSync(this.contextFile, 'utf8');
      return JSON.parse(content) as ContextEntry[];
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[context-broker] Failed to parse ${this.contextFile}: ${msg}`);
      return [];
    }
  }

  /**
   * Get context for specific steps (useful for dependency resolution).
   * When strictIsolation is true, only entries with verified transcript
   * evidence are returned -- rejects anything backed by shared mutable state.
   */
  getContextForSteps(stepNumbers: number[], strictIsolation = false): ContextEntry[] {
    const allContext = this.getAllContext();
    const byStep = allContext.filter(entry => stepNumbers.includes(entry.stepNumber));

    if (!strictIsolation) {
      return byStep;
    }

    // strict mode: only entries with a non-empty transcript path
    return byStep.filter(entry =>
      entry.data.transcript && entry.data.transcript.length > 0
    );
  }

  /**
   * Get summary of changes from dependent steps.
   * Strict isolation mode filters to transcript-backed entries only.
   */
  getDependencyContext(dependencies: number[], strictIsolation = false): string {
    if (dependencies.length === 0) {
      return 'No dependencies - you are starting fresh.';
    }

    const entries = this.getContextForSteps(dependencies, strictIsolation);

    if (entries.length === 0) {
      return `Dependencies: Steps ${dependencies.join(', ')} (context not yet available)`;
    }

    const lines: string[] = [];
    lines.push(`Context from ${entries.length} dependent step(s):`);

    entries.forEach(entry => {
      lines.push(`\nStep ${entry.stepNumber} (${entry.agentName}):`);
      lines.push(`  - ${entry.data.outputsSummary}`);

      if (entry.data.filesChanged.length > 0) {
        lines.push(`  - Files modified: ${entry.data.filesChanged.slice(0, 5).join(', ')}${entry.data.filesChanged.length > 5 ? '...' : ''}`);
      }

      if (entry.data.branchName) {
        lines.push(`  - Branch: ${entry.data.branchName}`);
      }

      if (entry.data.commitShas && entry.data.commitShas.length > 0) {
        lines.push(`  - Commits: ${entry.data.commitShas.length}`);
      }
    });

    return lines.join('\n');
  }

  /**
   * Check if all dependencies are satisfied
   */
  areDependenciesSatisfied(dependencies: number[]): boolean {
    if (dependencies.length === 0) {
      return true;
    }

    const completedSteps = new Set(
      this.getAllContext().map(entry => entry.stepNumber)
    );

    return dependencies.every(dep => completedSteps.has(dep));
  }

  /**
   * Wait for dependencies to be satisfied.
   * Uses EventEmitter notifications instead of file polling for zero-latency response.
   * Falls back to a timeout to prevent indefinite hangs.
   */
  async waitForDependencies(
    dependencies: number[],
    timeoutMs: number = DEFAULT_DEPENDENCY_WAIT_MS
  ): Promise<boolean> {
    if (this.areDependenciesSatisfied(dependencies)) {
      return true;
    }

    return new Promise((resolve) => {
      const remaining = new Set(
        dependencies.filter(dep => {
          const completedSteps = new Set(this.getAllContext().map(e => e.stepNumber));
          return !completedSteps.has(dep);
        })
      );

      if (remaining.size === 0) {
        resolve(true);
        return;
      }

      const timer = setTimeout(() => {
        this.removeListener('step-completed', onStep);
        resolve(false);
      }, timeoutMs);

      const onStep = (stepNumber: number) => {
        remaining.delete(stepNumber);
        if (remaining.size === 0) {
          clearTimeout(timer);
          this.removeListener('step-completed', onStep);
          resolve(true);
        }
      };

      this.on('step-completed', onStep);
    });
  }

  /**
   * Clear all context (useful for testing or fresh runs)
   */
  clearContext(): void {
    if (fs.existsSync(this.contextFile)) {
      fs.unlinkSync(this.contextFile);
    }

    // clean up any stale locks
    if (fs.existsSync(this.lockDir)) {
      const lockFiles = fs.readdirSync(this.lockDir);
      lockFiles.forEach(file => {
        fs.unlinkSync(path.join(this.lockDir, file));
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default ContextBroker;
