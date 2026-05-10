import { spawn } from 'child_process';

/**
 * Captured output and timing for a verification command.
 */
export interface VerificationCommandResult {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Run a shell command for a verification gate and capture its complete output.
 *
 * @param command - Shell command to run.
 * @param cwd - Working directory for the command.
 * @param timeoutMs - Maximum runtime before the process is killed.
 * @returns Structured command output, exit code, timeout flag, and duration.
 */
export function runVerificationCommand(
  command: string,
  cwd: string,
  timeoutMs = 120_000,
): Promise<VerificationCommandResult> {
  const started = Date.now();

  return new Promise((resolve) => {
    // Use bash explicitly so LLM-authored predicates that rely on bash
    // syntax (process substitution `<(...)`, `[[ ]]`, etc.) don't fail
    // under /bin/sh. Mirrors run-verifier.ts:VERIFICATION_SHELL.
    const proc = spawn(command, {
      cwd,
      shell: '/bin/bash',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let resolved = false;

    const finish = (exitCode: number): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve({
        command,
        cwd,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
      });
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // Process already exited.
        }
      }, 2_000);
    }, timeoutMs);

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      finish(code ?? 1);
    });

    proc.on('error', (err) => {
      stderr += stderr ? `\n${err.message}` : err.message;
      finish(1);
    });
  });
}
