// Shared subprocess lifecycle management: stall detection, heartbeat,
// graceful shutdown. Extracted from SessionExecutor.runCommand() so that
// all adapters (copilot, claude-code, claude-code-teams) get identical
// reliability guarantees.

import { ChildProcess, spawn, SpawnOptions } from 'child_process';
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_SIGKILL_DELAY_MS,
} from '../defaults';
import { getLogger } from '../logger';
const logger = getLogger('process-supervisor');

export interface SupervisedSpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv | undefined;
  logPrefix?: string | undefined;
  stallTimeoutMs?: number | undefined;
  // Called on each complete stdout/stderr line for action detection.
  // Optional: only used by adapters that want to surface agent activity.
  onLine?: ((line: string, stream: 'stdout' | 'stderr') => void) | undefined;
  // stdin handling. Default 'pipe' keeps existing behavior for copilot /
  // claude-code adapters (piped then immediately ended). 'ignore' wires
  // stdin to /dev/null, required for Codex which otherwise prints
  // "Reading additional input from stdin..." when it sees a pipe.
  stdinMode?: 'pipe' | 'ignore';
  // Optional payload to write to the child's stdin before closing it.
  // Required by adapters that pipe the prompt over stdin (e.g. Claude Code's
  // `claude -p -` form, used to avoid ARG_MAX on long prompts). Ignored when
  // stdinMode is 'ignore'.
  stdinData?: string | undefined;
}

export interface SupervisedResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Maximum silence before killing a stalled subprocess.
// Agent CLIs can go quiet during extended tool-use or thinking phases,
// so this needs headroom beyond typical inference latency.
const DEFAULT_STALL_TIMEOUT_MS = DEFAULT_COMMAND_TIMEOUT_MS * 2 + 60_000; // 5 minutes

// How often to check for stalls (ms)
const STALL_CHECK_INTERVAL_MS = DEFAULT_HEARTBEAT_INTERVAL_MS * 2;

// Grace period after SIGTERM before escalating to SIGKILL (ms)
const KILL_GRACE_MS = DEFAULT_SIGKILL_DELAY_MS;

// Only show heartbeat during quiet periods longer than this (ms)
const HEARTBEAT_QUIET_THRESHOLD_MS = DEFAULT_HEARTBEAT_INTERVAL_MS * 3;

// Heartbeat display interval (ms)
const HEARTBEAT_INTERVAL_MS = DEFAULT_HEARTBEAT_INTERVAL_MS * 3;

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Spawn a child process with stall detection, heartbeat logging, and
 * line-buffered output. Returns a promise that resolves when the process
 * exits or is killed due to inactivity.
 */
export function supervisedSpawn(opts: SupervisedSpawnOptions): Promise<SupervisedResult> {
  const stallTimeoutMs = opts.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;

  return new Promise((resolve) => {
    const stdinMode = opts.stdinMode ?? 'pipe';
    // process.env is merged in first so callers that pass partial env overrides
    // (e.g. buildRestrictedEnv) still inherit PATH, locale, keyring vars, and
    // OAuth state the agent CLI needs at runtime. opts.env is spread last so
    // explicit values, including `undefined` to scrub a key, win over the
    // inherited base.
    const spawnOpts: SpawnOptions = {
      cwd: opts.cwd,
      env: {
        ...process.env,
        ...opts.env,
      },
      stdio: [stdinMode, 'pipe', 'pipe'],
    };

    const proc = spawn(opts.command, opts.args, spawnOpts);

    // Close piped stdin so the subprocess never blocks waiting for interactive input.
    // When stdinMode is 'ignore' there is no proc.stdin to end.
    if (proc.stdin) {
      if (opts.stdinData) {
        proc.stdin.write(opts.stdinData);
      }
      proc.stdin.end();
    }

    let stdout = '';
    let stderr = '';
    let resolved = false;
    let killed = false;

    // Line buffers prevent mid-word breaks in streamed output
    let stdoutBuffer = '';
    let stderrBuffer = '';

    let lineCount = 0;
    let lastOutputTime = Date.now();
    const startTime = Date.now();
    let heartbeatInterval: NodeJS.Timeout | null = null;
    let stallCheckInterval: NodeJS.Timeout | null = null;
    let heartbeatCount = 0;

    const cleanup = () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (stallCheckInterval) clearInterval(stallCheckInterval);
    };

    const finish = (result: SupervisedResult) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    // Stall detection: kill subprocess if no output for stallTimeoutMs
    stallCheckInterval = setInterval(() => {
      const silentMs = Date.now() - lastOutputTime;
      if (silentMs >= stallTimeoutMs) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const stallSec = Math.round(silentMs / 1000);
        if (opts.logPrefix) {
          logger.info(
            `${opts.logPrefix} ⚠ STALL DETECTED: no output for ${stallSec}s ` +
            `(total ${elapsed}s, ${lineCount} lines). Killing process.`
          );
        }
        killed = true;
        killGracefully(proc);
        finish({
          stdout,
          stderr: stderr + `\nProcess killed after ${stallSec}s of no output (stall timeout)`,
          exitCode: 1
        });
      }
    }, STALL_CHECK_INTERVAL_MS);

    // Heartbeat: show progress during quiet periods
    if (opts.logPrefix) {
      heartbeatInterval = setInterval(() => {
        const silentMs = Date.now() - lastOutputTime;
        if (silentMs < HEARTBEAT_QUIET_THRESHOLD_MS) return;

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const frame = SPINNER_FRAMES[heartbeatCount % SPINNER_FRAMES.length];
        heartbeatCount++;

        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const timeStr = mins > 0 ? `${mins}m${secs}s` : `${secs}s`;

        logger.info(`${opts.logPrefix} ${frame} ${timeStr} elapsed | ${lineCount} lines`);
      }, HEARTBEAT_INTERVAL_MS);
    }

    const processLines = (buffer: string, newData: string, stream: 'stdout' | 'stderr'): string => {
      buffer += newData;
      const lines = buffer.split('\n');
      // Keep last (possibly incomplete) line in buffer
      const remaining = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          lineCount++;
          if (opts.onLine) opts.onLine(line, stream);
          if (opts.logPrefix && !killed) {
            if (stream === 'stderr') {
              logger.error(`${opts.logPrefix} ${line}`);
            } else {
              logger.info(`${opts.logPrefix} ${line}`);
            }
          }
        }
      }
      return remaining;
    };

    if (proc.stdout) {
      proc.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        lastOutputTime = Date.now();
        stdoutBuffer = processLines(stdoutBuffer, text, 'stdout');
      });
    }

    if (proc.stderr) {
      proc.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        lastOutputTime = Date.now();
        stderrBuffer = processLines(stderrBuffer, text, 'stderr');
      });
    }

    proc.on('close', (code) => {
      // Flush remaining buffered content
      if (opts.logPrefix && !killed) {
        if (stdoutBuffer.trim()) {
          lineCount++;
          logger.info(`${opts.logPrefix} ${stdoutBuffer}`);
        }
        if (stderrBuffer.trim()) {
          lineCount++;
          logger.error(`${opts.logPrefix} ${stderrBuffer}`);
        }
      }

      finish({ stdout, stderr, exitCode: code ?? 0 });
    });

    proc.on('error', (err) => {
      // Flush buffers on error too
      if (opts.logPrefix && !killed) {
        if (stdoutBuffer.trim()) {
          logger.info(`${opts.logPrefix} ${stdoutBuffer}`);
        }
        if (stderrBuffer.trim()) {
          logger.error(`${opts.logPrefix} ${stderrBuffer}`);
        }
      }

      finish({
        stdout,
        stderr: stderr + '\n' + err.message,
        exitCode: 1
      });
    });
  });
}

// SIGTERM first, then SIGKILL after a grace period if the process
// hasn't exited. Matches the shutdown behavior from SessionExecutor.
function killGracefully(proc: ChildProcess): void {
  try {
    proc.kill('SIGTERM');
  } catch { /* already dead */ }

  setTimeout(() => {
    try { proc.kill('SIGKILL'); } catch { /* already dead */ }
  }, KILL_GRACE_MS);
}
