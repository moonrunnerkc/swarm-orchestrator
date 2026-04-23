// OpenAI Codex CLI adapter: spawns `codex exec` for non-interactive use.
// Uses --dangerously-bypass-approvals-and-sandbox because git worktrees have
// .git references to the parent repo, which --full-auto's sandbox blocks.

import { AgentAdapter, AgentResult, AgentSpawnOptions, buildRestrictedEnv } from './agent-adapter';
import { supervisedSpawn } from './process-supervisor';

// Codex can spend significant time on reasoning and file operations
// without producing stdout, similar to Claude Code. supervisedSpawn's
// heartbeat surfaces progress during these quiet periods.
const STALL_TIMEOUT_MS = 600_000;

export class CodexAdapter implements AgentAdapter {
  readonly name = 'codex';

  async spawn(opts: AgentSpawnOptions): Promise<AgentResult> {
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
    };
  }
}
