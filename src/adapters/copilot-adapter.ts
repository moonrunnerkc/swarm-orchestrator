// Copilot CLI adapter: spawns `copilot -p` with the same flags and behavior
// as the original SessionExecutor.runCommand path. This is a refactor, not
// new behavior; it preserves the stall detection, line buffering, and heartbeat
// logic from the original implementation.

import { AgentAdapter, AgentResult, AgentSpawnOptions } from './agent-adapter';
import { classifyFatalAgentError } from './fatal-error-classifier';
import { PersistentInteractiveSession } from './persistent-session';
import { supervisedSpawn } from './process-supervisor';
import { getLogger } from '../logger';
import {
  invokeWithTransientRetry,
  isTransientApiError,
} from '../copilot-transient-retry';

const logger = getLogger('copilot-adapter');

/**
 * Maximum re-spawn attempts when the Copilot CLI prints the
 * "Request failed due to a transient API error. Retrying..." marker
 * and exits non-zero. Matches the falsifier's budget so v6 worker
 * and v8 falsifier behave identically under transient upstream
 * provider failure. Three is the same retry budget the v6 repair
 * agent uses.
 */
const COPILOT_TRANSIENT_RETRY_ATTEMPTS = 3;

// Maximum silence before killing a stalled copilot subprocess.
// Copilot CLI can go quiet for several minutes during extended tool-use
// or thinking phases, so this needs headroom beyond typical inference time.
const STALL_TIMEOUT_MS = 300_000;

// Copilot CLI outputs these when an agent tries to access paths outside its sandbox
const SCOPE_NOISE_PATTERNS = [
  /Permission denied and could not request permission/i,
  /could not request permission from user/i,
];

// Env vars Copilot CLI prefers over its keyring OAuth for authentication.
// If the user has a repo-scoped PAT (e.g. GITHUB_TOKEN in .env) that lacks
// "Copilot Requests" permission, Copilot picks it up and every session 401s
// before a single tool call runs. Scrub these by default so Copilot falls
// back to the keyring token the user already authenticated with via
// `copilot /login`. Opt back in by setting SWARM_USE_ENV_GITHUB_TOKEN=1
// when you do have a Copilot-capable PAT and want to force env-based auth.
const COPILOT_AUTH_ENV_VARS = ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'];

export function scrubCopilotHostileTokens(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.SWARM_USE_ENV_GITHUB_TOKEN === '1') {
    return { ...env };
  }
  const copy = { ...env };
  for (const key of COPILOT_AUTH_ENV_VARS) {
    delete copy[key];
  }
  return copy;
}

// Build the env spread the spawn helpers feed Copilot. The supervisor merges
// process.env first, so the scrubbed tokens have to be set to `undefined`
// here (not just deleted from a copy) to actually unset them in the child.
// Returns the same shape for cold-start and persistent paths so they stay
// in sync. Respects SWARM_USE_ENV_GITHUB_TOKEN=1 by leaving the tokens
// alone when the user has explicitly opted into env-based Copilot auth.
function copilotChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    GIT_AUTHOR_NAME: 'swarm-orchestrator',
    GIT_AUTHOR_EMAIL: 'swarm@localhost',
    GIT_COMMITTER_NAME: 'swarm-orchestrator',
    GIT_COMMITTER_EMAIL: 'swarm@localhost',
    COPILOT_ALLOW_ALL: 'true',
  };
  if (process.env.SWARM_USE_ENV_GITHUB_TOKEN !== '1') {
    for (const key of COPILOT_AUTH_ENV_VARS) {
      env[key] = undefined;
    }
  }
  return env;
}

// Billing-accurate premium-request count, as reported by the Copilot CLI
// on its stderr summary block. Format example:
//
//   Changes   +2 -0
//   Requests  4 Premium (112s)
//   Tokens    ↑ ...
//
// Copilot bills by Premium requests, not raw model invocations, and a
// multi-tool-use session is usually billed as 1. Parsing this line is
// the only way to get a number that matches the user's actual bill.
// Returns undefined when the marker is absent (e.g. auth failure).
const COPILOT_REQUEST_LINE_RE = /^\s*Requests\s+(\d+)\s+Premium\b/m;

export function parseCopilotRequestCount(stderr: string): number | undefined {
  if (!stderr) return undefined;
  const m = stderr.match(COPILOT_REQUEST_LINE_RE);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// Copilot CLI sometimes exits 0 even on fatal errors like invalid model
// names or auth failures. These patterns on stderr indicate the session
// never ran at all.
const FATAL_STDERR_PATTERNS = [
  /Model ".*" from --model flag is not available/i,
  /Error:.*not available/i,
  /Authentication failed/i,
  /token.*(?:invalid|expired|lacking)/i,
];

function isScopeNoise(line: string): boolean {
  return SCOPE_NOISE_PATTERNS.some(p => p.test(line));
}

// Exported for direct testing without spawning real subprocesses
export function hasFatalStderrError(stderr: string): boolean {
  return FATAL_STDERR_PATTERNS.some(p => p.test(stderr));
}

export class CopilotAdapter implements AgentAdapter {
  readonly name = 'copilot';
  readonly supportsPersistentInteractive = true;
  private readonly persistentSessions = new Map<string, PersistentInteractiveSession>();

  async spawn(opts: AgentSpawnOptions): Promise<AgentResult> {
    const persistent = await this.tryPersistent(opts);
    if (persistent) return persistent;

    const startTime = Date.now();
    const args: string[] = ['-p', opts.prompt];

    if (opts.model) {
      args.push('--model', opts.model);
    }

    // --allow-all covers tools, paths, and URLs so the subprocess
    // never blocks waiting for interactive approval on stdin.
    args.push('--allow-all');

    if (opts.copilotAgent) {
      args.push('--agent', opts.copilotAgent);
    }

    // Wrap supervisedSpawn in transient-retry. The Copilot CLI sometimes
    // prints "Request failed due to a transient API error. Retrying..."
    // to stdout/stderr and then exits non-zero despite the implied
    // self-retry. v6 worker runs died mid-session on this and produced
    // empty branches; re-spawning the same prompt within seconds
    // reliably succeeds. The session is one-shot (`-p`) and the child
    // workdir is the worker's branch — when the transient error fires
    // before the CLI made any file changes (the observed pattern),
    // re-spawning is safe and recovers the run.
    const result = await invokeWithTransientRetry(
      () =>
        supervisedSpawn({
          command: 'copilot',
          args,
          cwd: opts.workdir,
          // Copilot CLI authenticates via gh's local keyring, not env-var API keys.
          // It needs the full user environment (XDG_CONFIG_HOME, DBUS_SESSION_BUS_ADDRESS,
          // keyring paths, etc.) to locate stored credentials. Restricting the env
          // like we do for API-key-based adapters breaks auth silently.
          env: copilotChildEnv(),
          logPrefix: opts.logPrefix,
          stallTimeoutMs: opts.timeout ?? STALL_TIMEOUT_MS,
          onLine: opts.onAgentLine ? (line) => opts.onAgentLine!(line) : undefined,
        }),
      {
        maxAttempts: COPILOT_TRANSIENT_RETRY_ATTEMPTS,
        onAttempt: (res, attempt) => {
          if (attempt < COPILOT_TRANSIENT_RETRY_ATTEMPTS && isTransientApiError(res)) {
            logger.warn(
              `copilot worker transient API error on attempt ${attempt}/${COPILOT_TRANSIENT_RETRY_ATTEMPTS}; re-spawning`,
            );
          }
        },
      },
    );
    const durationMs = Date.now() - startTime;

    // Copilot prints scope-enforcement messages on stderr when an agent tries
    // to access paths outside its sandbox. These add no diagnostic value to
    // verification or fatal-error parsing, so strip them from the captured
    // stderr before downstream consumers see it. Live streaming via logPrefix
    // may still surface them in real time, which is the correct UX.
    const filteredStderr = result.stderr
      .split('\n')
      .filter((l) => !isScopeNoise(l))
      .join('\n');

    // Copilot CLI exits 0 for certain fatal errors (e.g. invalid model name)
    // that produce no stdout. Detect these and correct the exit code so the
    // orchestrator treats the session as failed rather than empty-but-successful.
    let exitCode = result.exitCode;
    if (exitCode === 0 && !result.stdout.trim() && hasFatalStderrError(filteredStderr)) {
      exitCode = 1;
    }

    const fatalError = classifyFatalAgentError(result.stdout, filteredStderr, exitCode);

    return {
      stdout: result.stdout,
      stderr: filteredStderr,
      exitCode,
      durationMs,
      executionMode: 'cold-start',
      premiumRequestsConsumed: parseCopilotRequestCount(filteredStderr),
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
    const sessionKey = opts.persistentSessionId ?? `${opts.workdir}:${opts.model ?? 'default'}:${opts.copilotAgent ?? ''}`;
    const args = ['--allow-all', '--no-ask-user', '--stream', 'on'];
    if (opts.model) args.push('--model', opts.model);
    if (opts.copilotAgent) args.push('--agent', opts.copilotAgent);

    let session = this.persistentSessions.get(sessionKey);
    if (!session || session.unavailable) {
      session = new PersistentInteractiveSession({
        command: 'copilot',
        args,
        cwd: opts.workdir,
        env: {
          ...scrubCopilotHostileTokens(process.env),
          GIT_AUTHOR_NAME: 'swarm-orchestrator',
          GIT_AUTHOR_EMAIL: 'swarm@localhost',
          GIT_COMMITTER_NAME: 'swarm-orchestrator',
          GIT_COMMITTER_EMAIL: 'swarm@localhost',
          COPILOT_ALLOW_ALL: 'true',
        },
        onLine: (line) => opts.onAgentLine?.(`[copilot:persistent] ${line}`),
      });
      this.persistentSessions.set(sessionKey, session);
    }

    const result = await session.send(opts.prompt, opts.persistentTurnTimeoutMs ?? opts.timeout ?? STALL_TIMEOUT_MS);
    if (result.exitCode === 0) {
      return {
        ...result,
        executionMode: 'persistent-interactive',
        premiumRequestsConsumed: parseCopilotRequestCount(result.stderr),
      };
    }

    const fatalError = classifyFatalAgentError(result.stdout, result.stderr, result.exitCode);
    const reason = session.reason ?? (result.stderr || 'persistent interactive mode failed');
    this.persistentSessions.delete(sessionKey);
    await session.shutdown();
    // Same short-circuit rationale as in codex / claude adapters: a fatal
    // account-level error makes the cold-start fallback equally doomed.
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

}

function shouldAttemptPersistent(opts: AgentSpawnOptions): boolean {
  if (opts.executionMode === 'persistent-interactive') return true;
  return opts.executionMode === 'auto' && process.env.SWARM_ENABLE_PERSISTENT_INTERACTIVE === '1';
}
