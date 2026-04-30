// Claude Code CLI adapter: spawns `claude` with --dangerously-skip-permissions
// for non-interactive use. No transcript sharing; stdout/stderr captured directly.

import { AgentAdapter, AgentResult, AgentSpawnOptions, buildRestrictedEnv } from './agent-adapter';
import { classifyFatalAgentError } from './fatal-error-classifier';
import { PersistentInteractiveSession } from './persistent-session';
import { supervisedSpawn } from './process-supervisor';

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

    const result = await supervisedSpawn({
      command: 'claude',
      args,
      cwd: opts.workdir,
      env: buildRestrictedEnv(['ANTHROPIC_API_KEY']),
      logPrefix: opts.logPrefix,
      stallTimeoutMs: opts.timeout ?? STALL_TIMEOUT_MS,
      stdinData: opts.prompt,
      onLine: opts.onAgentLine ? (line) => opts.onAgentLine!(line) : undefined,
    });
    const durationMs = Date.now() - startTime;

    // D5: Parse premium request count from Claude Code CLI output.
    // Claude Code prints a cost/usage summary that we can extract.
    // Fallback: count conversation turns (each assistant response = 1 request).
    const premiumRequestsConsumed = this.parseRequestCount(result.stdout, result.stderr);
    const fatalError = classifyFatalAgentError(result.stdout, result.stderr, result.exitCode);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs,
      executionMode: 'cold-start',
      premiumRequestsConsumed,
      ...(fatalError ? { fatalError } : {}),
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

    const fatalError = classifyFatalAgentError(result.stdout, result.stderr, result.exitCode);
    const reason = session.reason ?? (result.stderr || 'persistent interactive mode failed');
    this.persistentSessions.delete(sessionKey);
    await session.shutdown();
    // Fatal account-level errors short-circuit the cold-start fallback for
    // the same reason as in the codex adapter: another spawn cannot recover
    // from a usage-limit or auth wall.
    if (opts.executionMode === 'persistent-interactive' || fatalError) {
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: Date.now() - startTime,
        executionMode: 'persistent-interactive',
        fallbackReason: reason,
        ...(fatalError ? { fatalError } : {}),
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

}

function shouldAttemptPersistent(opts: AgentSpawnOptions): boolean {
  if (opts.executionMode === 'persistent-interactive') return true;
  return opts.executionMode === 'auto' && process.env.SWARM_ENABLE_PERSISTENT_INTERACTIVE === '1';
}
