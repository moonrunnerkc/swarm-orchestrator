// OpenAI Codex CLI adapter: spawns `codex exec` for non-interactive use.
// Uses --dangerously-bypass-approvals-and-sandbox because git worktrees have
// .git references to the parent repo, which --full-auto's sandbox blocks.

import { AgentAdapter, AgentResult, AgentSpawnOptions, buildRestrictedEnv } from './agent-adapter';
import { PersistentInteractiveSession } from './persistent-session';
import { supervisedSpawn } from './process-supervisor';

// Codex can spend significant time on reasoning and file operations
// without producing stdout, similar to Claude Code. supervisedSpawn's
// heartbeat surfaces progress during these quiet periods.
const STALL_TIMEOUT_MS = 600_000;

export class CodexAdapter implements AgentAdapter {
  readonly name = 'codex';
  readonly supportsPersistentInteractive = true;
  private readonly persistentSessions = new Map<string, PersistentInteractiveSession>();

  async spawn(opts: AgentSpawnOptions): Promise<AgentResult> {
    const persistent = await this.tryPersistent(opts);
    if (persistent) return persistent;

    const startTime = Date.now();
    const args: string[] = [
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      '-C', opts.workdir,
    ];

    if (opts.model) {
      args.push('-m', opts.model);
    }

    args.push(opts.prompt);

    // stdinMode: 'ignore' prevents Codex from printing
    // "Reading additional input from stdin..." into the transcript when it
    // detects a piped (but empty) stdin. With stdin wired to /dev/null Codex
    // treats the prompt arg as the full instruction.
    const result = await supervisedSpawn({
      command: 'codex',
      args,
      cwd: opts.workdir,
      env: buildRestrictedEnv(['OPENAI_API_KEY']),
      logPrefix: '[codex]',
      stallTimeoutMs: opts.timeout ?? STALL_TIMEOUT_MS,
      stdinMode: 'ignore',
    });

    const durationMs = Date.now() - startTime;

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs,
      executionMode: 'cold-start',
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
    const args = [
      '--dangerously-bypass-approvals-and-sandbox',
      '-C', opts.workdir,
      '--no-alt-screen',
    ];
    if (opts.model) args.push('-m', opts.model);

    let session = this.persistentSessions.get(sessionKey);
    if (!session || session.unavailable) {
      session = new PersistentInteractiveSession({
        command: 'codex',
        args,
        cwd: opts.workdir,
        env: buildRestrictedEnv(['OPENAI_API_KEY']),
        onLine: (line) => opts.onAgentLine?.(`[codex:persistent] ${line}`),
      });
      this.persistentSessions.set(sessionKey, session);
    }

    const result = await session.send(opts.prompt, opts.persistentTurnTimeoutMs ?? opts.timeout ?? STALL_TIMEOUT_MS);
    if (result.exitCode === 0) {
      return {
        ...result,
        executionMode: 'persistent-interactive',
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
}

function shouldAttemptPersistent(opts: AgentSpawnOptions): boolean {
  if (opts.executionMode === 'persistent-interactive') return true;
  return opts.executionMode === 'auto' && process.env.SWARM_ENABLE_PERSISTENT_INTERACTIVE === '1';
}
