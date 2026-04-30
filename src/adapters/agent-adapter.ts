// Unified interface for spawning CLI-based coding agents.
// Each adapter wraps a specific tool (Copilot, Claude Code, Codex)
// behind a common contract so the orchestrator can drive any of them.

import type { FatalAgentError } from './fatal-error-classifier';

export interface AgentResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  shareTranscriptPath?: string | undefined;
  executionMode?: 'cold-start' | 'persistent-interactive' | undefined;
  fallbackReason?: string | undefined;
  /**
   * Instrumented count of premium API requests consumed during this session.
   * Parsed from CLI output markers (e.g. Claude Code cost summary).
   * undefined means the adapter could not determine the count.
   */
  premiumRequestsConsumed?: number | undefined;
  /**
   * Set when the agent CLI reported an unrecoverable, account-level failure
   * (usage-limit hit, expired auth, multi-hour rate-limit window). Replan
   * and repair cannot recover from these, so the orchestrator must abort
   * the run instead of consuming the remaining per-instance budget on
   * doomed retries. Populated by the adapter via classifyFatalAgentError.
   */
  fatalError?: FatalAgentError | undefined;
}

export interface AgentSpawnOptions {
  prompt: string;
  workdir: string;
  model?: string | undefined;
  timeout?: number | undefined;
  copilotAgent?: string | undefined;
  executionMode?: 'cold-start' | 'persistent-interactive' | 'auto' | undefined;
  persistentSessionId?: string | undefined;
  persistentTurnTimeoutMs?: number | undefined;
  onAgentLine?: ((line: string) => void) | undefined;
  /**
   * Step-aware label printed alongside live agent output and the heartbeat
   * spinner during quiet periods. When set, the cold-start subprocess
   * surfaces stdout/stderr lines and "Ns elapsed" ticks instead of running
   * silently. Format is the caller's choice (e.g. "[backend_master:1]").
   */
  logPrefix?: string | undefined;
}

export interface AgentAdapter {
  name: string;
  supportsPersistentInteractive?: boolean | undefined;
  spawn(opts: AgentSpawnOptions): Promise<AgentResult>;
  shutdown?(): Promise<void>;
}

// Builds a minimal process.env for agent subprocesses. Only the keys the
// adapter actually needs are forwarded, limiting blast radius if a CLI
// tool is compromised or unexpectedly dumps its environment.
export function buildRestrictedEnv(adapterKeys: string[]): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: process.env.HOME || '/tmp',
    GIT_AUTHOR_NAME: 'swarm-orchestrator',
    GIT_AUTHOR_EMAIL: 'swarm@localhost',
    GIT_COMMITTER_NAME: 'swarm-orchestrator',
    GIT_COMMITTER_EMAIL: 'swarm@localhost',
  };

  // Forward config directory vars so CLI tools find their OAuth/session credentials
  const configVars = ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'TMPDIR', 'TERM'];
  for (const key of configVars) {
    const val = process.env[key];
    if (val) env[key] = val;
  }

  for (const key of adapterKeys) {
    const val = process.env[key];
    if (val) env[key] = val;
  }
  return env;
}
