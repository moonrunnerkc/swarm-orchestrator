import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { ObligationV1 } from '../contract/types';

/**
 * Per-obligation verification result. Phase 2's verifier is the
 * post-generation, pre-commit checker described in
 * `v8-overhaul-guide.md` §5.5. Streaming and post-merge checks come in
 * Phase 6.
 */
export interface VerificationResult {
  satisfied: boolean;
  detail: string;
}

export interface VerifyOptions {
  /** Repo root the command runs in / file paths are resolved against. */
  repoRoot: string;
  /** Cap on each command's wall time, in ms. */
  commandTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Verify a single obligation against the repository on disk.
 *
 *   - `file-must-exist`: stat the path under repoRoot.
 *   - `build-must-pass`: spawn the command; satisfied when exit zero.
 *   - `test-must-pass`: spawn the command; satisfied when exit zero.
 *
 * No retries, no auto-repair: Phase 2 is verify-then-record. The
 * population manager decides what to do with a failure.
 */
export function verifyObligation(
  obligation: ObligationV1,
  options: VerifyOptions,
): VerificationResult {
  switch (obligation.type) {
    case 'file-must-exist':
      return verifyFileExists(obligation.path, options.repoRoot);
    case 'build-must-pass':
      return verifyCommand(obligation.command, options);
    case 'test-must-pass':
      return verifyCommand(obligation.command, options);
  }
}

function verifyFileExists(relPath: string, repoRoot: string): VerificationResult {
  const abs = path.isAbsolute(relPath) ? relPath : path.join(repoRoot, relPath);
  try {
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      return { satisfied: true, detail: `file exists at ${relPath}` };
    }
    return { satisfied: false, detail: `${relPath} exists but is not a regular file` };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { satisfied: false, detail: `file ${relPath} does not exist under ${repoRoot}` };
    }
    return {
      satisfied: false,
      detail: `stat ${relPath} failed: ${(err as Error).message}`,
    };
  }
}

function verifyCommand(command: string, options: VerifyOptions): VerificationResult {
  const timeout = options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const result = spawnSync(command, {
    cwd: options.repoRoot,
    shell: true,
    encoding: 'utf8',
    timeout,
    env: process.env,
  });

  if (result.error) {
    const errCode = (result.error as NodeJS.ErrnoException).code;
    if (errCode === 'ETIMEDOUT') {
      return {
        satisfied: false,
        detail: `command "${command}" timed out after ${timeout}ms`,
      };
    }
    return {
      satisfied: false,
      detail: `command "${command}" failed to start: ${result.error.message}`,
    };
  }

  if (result.status === 0) {
    return { satisfied: true, detail: `command "${command}" exited 0` };
  }
  const tail = (result.stderr || result.stdout || '').slice(-512).trim();
  return {
    satisfied: false,
    detail:
      `command "${command}" exited ${result.status ?? 'null'}` +
      (tail ? `; tail: ${tail}` : ''),
  };
}
