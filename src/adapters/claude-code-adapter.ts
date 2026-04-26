// Claude Code CLI adapter: spawns `claude` with --dangerously-skip-permissions
// for non-interactive use. No transcript sharing; stdout/stderr captured directly.

import { spawn, SpawnOptions } from 'child_process';
import { AgentAdapter, AgentResult, AgentSpawnOptions, buildRestrictedEnv } from './agent-adapter';
import { PersistentInteractiveSession } from './persistent-session';

// Claude Code can spend several minutes on internal reasoning and multi-file
// operations without producing stdout, unlike streaming CLI tools.
const STALL_TIMEOUT_MS = 600_000;

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = 'claude-code';
  readonly supportsPersistentInteractive = true;
  private readonly persistentSessions = new Map<string, PersistentInteractiveSession>();

  async spawn(opts: AgentSpawnOptions): Promise<AgentResult> {
    const persistent = await this.tryPersistent(opts);
    if (persistent) return persistent;

    const startTime = Date.now();
    // Pipe the prompt via stdin instead of passing it as a CLI argument.
    // Long prompts (SWE-bench issue descriptions with embedded code) can
    // exceed Linux ARG_MAX (~2 MB total argv+env), causing spawn E2BIG.
    // Claude Code supports: echo "prompt" | claude --dangerously-skip-permissions -p -
    const args: string[] = ['--dangerously-skip-permissions', '-p', '-'];

    if (opts.model) {
      args.push('--model', opts.model);
    }

    const result = await this.runProcess('claude', args, opts.workdir, opts.timeout, opts.prompt);
    const durationMs = Date.now() - startTime;

    // D5: Parse premium request count from Claude Code CLI output.
    // Claude Code prints a cost/usage summary that we can extract.
    // Fallback: count conversation turns (each assistant response = 1 request).
    const premiumRequestsConsumed = this.parseRequestCount(result.stdout, result.stderr);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs,
      executionMode: 'cold-start',
      premiumRequestsConsumed,
    };
  }

  async shutdown(): Promise<void> {
    await Promise.all(Array.from(this.persistentSessions.values()).map(session => session.shutdown()));
    this.persistentSessions.clear();
  }

  private async tryPersistent(opts: AgentSpawnOptions): Promise<AgentResult | undefined> {
    if (!shouldAttemptPersistent(opts)) return undefined;

    const startTime = Date.now();
    const sessionKey = opts.persistentSessionId ?? `${opts.workdir}:${opts.model ?? 'default'}`;
    const args = ['--dangerously-skip-permissions'];
    if (opts.model) args.push('--model', opts.model);

    let session = this.persistentSessions.get(sessionKey);
    if (!session || session.unavailable) {
      session = new PersistentInteractiveSession({
        command: 'claude',
        args,
        cwd: opts.workdir,
        env: buildRestrictedEnv(['ANTHROPIC_API_KEY']),
        onLine: (line) => opts.onAgentLine?.(`[claude-code:persistent] ${line}`),
      });
      this.persistentSessions.set(sessionKey, session);
    }

    const result = await session.send(opts.prompt, opts.persistentTurnTimeoutMs ?? opts.timeout ?? STALL_TIMEOUT_MS);
    if (result.exitCode === 0) {
      return {
        ...result,
        executionMode: 'persistent-interactive',
        premiumRequestsConsumed: this.parseRequestCount(result.stdout, result.stderr),
      };
    }

    const reason = session.reason ?? (result.stderr || 'persistent interactive mode failed');
    this.persistentSessions.delete(sessionKey);
    await session.shutdown();
    if (opts.executionMode === 'persistent-interactive') {
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: Date.now() - startTime,
        executionMode: 'persistent-interactive',
        fallbackReason: reason,
      };
    }
    return undefined;
  }

  /**
   * D5: Extract the number of premium API requests from Claude Code output.
   * Claude Code's `claude -p` does not currently emit a stable per-session
   * "premium requests consumed" marker on stdout or stderr — the turn
   * markers the old version counted never appear in non-interactive mode.
   *
   * Return undefined rather than a synthetic "1" so the orchestrator can
   * fall back honestly and `premium_requests_actual` does not silently
   * encode "one per step" when the real count is unknown.
   */
  private parseRequestCount(_stdout: string, _stderr: string): number | undefined {
    return undefined;
  }

  private runProcess(
    command: string,
    args: string[],
    workdir: string,
    timeout?: number,
    stdinData?: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      // Forward ANTHROPIC_API_KEY if available; Claude Code also supports
      // subscription auth via ~/.claude/ when no key is set.
      const spawnOpts: SpawnOptions = {
        cwd: workdir,
        env: buildRestrictedEnv(['ANTHROPIC_API_KEY']),
      };

      const proc = spawn(command, args, spawnOpts);

      if (proc.stdin) {
        if (stdinData) {
          proc.stdin.write(stdinData);
        }
        proc.stdin.end();
      }

      let stdout = '';
      let stderr = '';
      let resolved = false;
      let lastOutputTime = Date.now();
      let stallCheckInterval: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (stallCheckInterval) clearInterval(stallCheckInterval);
      };

      const effectiveTimeout = timeout || STALL_TIMEOUT_MS;

      stallCheckInterval = setInterval(() => {
        const silentMs = Date.now() - lastOutputTime;
        if (silentMs >= effectiveTimeout) {
          cleanup();
          proc.kill('SIGTERM');
          setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch { /* already dead */ }
          }, 5000);
          if (!resolved) {
            resolved = true;
            resolve({
              stdout,
              stderr: stderr + `\nProcess killed after ${Math.round(silentMs / 1000)}s of no output (stall timeout)`,
              exitCode: 1,
            });
          }
        }
      }, 10_000);

      if (proc.stdout) {
        proc.stdout.on('data', (data) => {
          stdout += data.toString();
          lastOutputTime = Date.now();
        });
      }

      if (proc.stderr) {
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
          lastOutputTime = Date.now();
        });
      }

      proc.on('close', (code) => {
        cleanup();
        if (!resolved) {
          resolved = true;
          // null exit code means process was killed by a signal; treat as failure
          resolve({ stdout, stderr, exitCode: code ?? 1 });
        }
      });

      proc.on('error', (err) => {
        cleanup();
        if (!resolved) {
          resolved = true;
          resolve({ stdout, stderr: stderr + '\n' + err.message, exitCode: 1 });
        }
      });
    });
  }
}

function shouldAttemptPersistent(opts: AgentSpawnOptions): boolean {
  if (opts.executionMode === 'persistent-interactive') return true;
  return opts.executionMode === 'auto' && process.env.SWARM_ENABLE_PERSISTENT_INTERACTIVE === '1';
}
