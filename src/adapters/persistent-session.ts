import { ChildProcess, spawn, SpawnOptions } from 'child_process';

export interface PersistentSessionConfig {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv | undefined;
  endTokenPrefix?: string | undefined;
  startupTimeoutMs?: number | undefined;
  idleTimeoutMs?: number | undefined;
  onLine?: ((line: string, stream: 'stdout' | 'stderr') => void) | undefined;
}

export interface PersistentTurnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

interface PendingTurn {
  token: string;
  startedAt: number;
  stdout: string;
  stderr: string;
  resolve: (result: PersistentTurnResult) => void;
  timeout: NodeJS.Timeout;
}

const DEFAULT_END_TOKEN_PREFIX = 'SWARM_TURN_DONE';
const DEFAULT_TURN_TIMEOUT_MS = 600_000;

/**
 * Keeps one CLI process alive and feeds prompts over stdin.
 *
 * The child must echo the requested end token on stdout when a turn is done.
 * If it exits, stalls, or never emits the marker, callers can fall back to the
 * adapter's regular cold-start path.
 */
export class PersistentInteractiveSession {
  private proc: ChildProcess | undefined;
  private pending: PendingTurn | undefined;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private unavailableReason: string | undefined;
  private turnCounter = 0;
  private readonly endTokenPrefix: string;

  constructor(private readonly config: PersistentSessionConfig) {
    this.endTokenPrefix = config.endTokenPrefix ?? DEFAULT_END_TOKEN_PREFIX;
  }

  get unavailable(): boolean {
    return this.unavailableReason !== undefined;
  }

  get reason(): string | undefined {
    return this.unavailableReason;
  }

  async send(prompt: string, timeoutMs = DEFAULT_TURN_TIMEOUT_MS): Promise<PersistentTurnResult> {
    if (this.unavailableReason) {
      return this.failedResult(this.unavailableReason, 0);
    }
    if (this.pending) {
      return this.failedResult('persistent session already has an active turn', 0);
    }

    const startedAt = Date.now();
    const proc = this.ensureStarted();
    if (!proc || this.unavailableReason) {
      return this.failedResult(this.unavailableReason ?? 'persistent session failed to start', Date.now() - startedAt);
    }

    const token = `${this.endTokenPrefix}:${Date.now()}:${++this.turnCounter}`;
    const framedPrompt = [
      prompt,
      '',
      'When this turn is fully complete, print this exact marker on its own line:',
      token,
      '',
    ].join('\n');

    return new Promise<PersistentTurnResult>((resolve) => {
      const timeout = setTimeout(() => {
        const pending = this.pending;
        if (!pending || pending.token !== token) return;
        this.pending = undefined;
        this.markUnavailable(`persistent turn timed out waiting for ${token}`);
        resolve({
          stdout: pending.stdout,
          stderr: appendLine(pending.stderr, `Timed out waiting for end-of-turn marker ${token}`),
          exitCode: 1,
          durationMs: Date.now() - pending.startedAt,
        });
      }, timeoutMs);

      this.pending = {
        token,
        startedAt,
        stdout: '',
        stderr: '',
        resolve,
        timeout,
      };

      try {
        if (!proc.stdin) throw new Error('persistent process stdin is unavailable');
        proc.stdin.write(framedPrompt);
        proc.stdin.write('\n');
      } catch (err: unknown) {
        clearTimeout(timeout);
        this.pending = undefined;
        this.markUnavailable(err instanceof Error ? err.message : String(err));
        resolve(this.failedResult(this.unavailableReason ?? 'stdin write failed', Date.now() - startedAt));
      }
    });
  }

  async shutdown(): Promise<void> {
    if (!this.proc) return;
    const proc = this.proc;
    this.proc = undefined;
    try {
      proc.stdin?.end();
    } catch {
      // Process may already be closed.
    }
    try {
      proc.kill('SIGTERM');
    } catch {
      // Process may already be closed.
    }
  }

  private ensureStarted(): ChildProcess | undefined {
    if (this.proc && !this.proc.killed) return this.proc;

    const spawnOpts: SpawnOptions = {
      cwd: this.config.cwd,
      env: {
        ...process.env,
        ...this.config.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    let proc: ChildProcess;
    try {
      proc = spawn(this.config.command, this.config.args, spawnOpts);
      this.proc = proc;
    } catch (err: unknown) {
      this.markUnavailable(err instanceof Error ? err.message : String(err));
      return undefined;
    }

    proc.stdout?.on('data', (data: Buffer) => {
      this.handleOutput(data.toString(), 'stdout');
    });
    proc.stderr?.on('data', (data: Buffer) => {
      this.handleOutput(data.toString(), 'stderr');
    });
    proc.on('close', (code) => {
      this.markUnavailable(`persistent process exited with code ${code ?? 1}`);
    });
    proc.on('error', (err) => {
      this.markUnavailable(err.message);
    });

    return proc;
  }

  private handleOutput(text: string, stream: 'stdout' | 'stderr'): void {
    const pending = this.pending;
    if (pending) {
      if (stream === 'stdout') pending.stdout += text;
      else pending.stderr += text;
    }

    const buffer = stream === 'stdout'
      ? this.stdoutBuffer + text
      : this.stderrBuffer + text;
    const lines = buffer.split('\n');
    const remaining = lines.pop() ?? '';
    if (stream === 'stdout') this.stdoutBuffer = remaining;
    else this.stderrBuffer = remaining;

    for (const line of lines) {
      this.config.onLine?.(line, stream);
      this.maybeFinishTurn(line);
    }
  }

  private maybeFinishTurn(line: string): void {
    const pending = this.pending;
    if (!pending || !line.includes(pending.token)) return;

    clearTimeout(pending.timeout);
    this.pending = undefined;
    const stdout = pending.stdout.replace(pending.token, '').trimEnd();
    pending.resolve({
      stdout,
      stderr: pending.stderr,
      exitCode: 0,
      durationMs: Date.now() - pending.startedAt,
    });
  }

  private markUnavailable(reason: string): void {
    this.unavailableReason = reason;
    if (this.pending) {
      const pending = this.pending;
      clearTimeout(pending.timeout);
      this.pending = undefined;
      pending.resolve({
        stdout: pending.stdout,
        stderr: appendLine(pending.stderr, reason),
        exitCode: 1,
        durationMs: Date.now() - pending.startedAt,
      });
    }
    try {
      this.proc?.kill('SIGTERM');
    } catch {
      // Already gone.
    }
  }

  private failedResult(reason: string, durationMs: number): PersistentTurnResult {
    return { stdout: '', stderr: reason, exitCode: 1, durationMs };
  }
}

function appendLine(base: string, line: string): string {
  return base ? `${base}\n${line}` : line;
}
