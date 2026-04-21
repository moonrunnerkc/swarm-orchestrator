// Copilot CLI adapter: spawns `copilot -p` with the same flags and behavior
// as the original SessionExecutor.runCommand path. This is a refactor, not
// new behavior; it preserves the stall detection, line buffering, and heartbeat
// logic from the original implementation.

import { spawn, SpawnOptions } from 'child_process';
import { AgentAdapter, AgentResult, AgentSpawnOptions } from './agent-adapter';

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

  async spawn(opts: AgentSpawnOptions): Promise<AgentResult> {
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

    const result = await this.runProcess('copilot', args, opts.workdir, opts.timeout);
    const durationMs = Date.now() - startTime;

    // Copilot CLI exits 0 for certain fatal errors (e.g. invalid model name)
    // that produce no stdout. Detect these and correct the exit code so the
    // orchestrator treats the session as failed rather than empty-but-successful.
    let exitCode = result.exitCode;
    if (exitCode === 0 && !result.stdout.trim() && hasFatalStderrError(result.stderr)) {
      exitCode = 1;
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode,
      durationMs,
      premiumRequestsConsumed: parseCopilotRequestCount(result.stderr),
    };
  }

  private runProcess(
    command: string,
    args: string[],
    workdir: string,
    timeout?: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const spawnOpts: SpawnOptions = {
        cwd: workdir,
        env: {
          // Copilot CLI authenticates via gh's local keyring, not env-var API keys.
          // It needs the full user environment (XDG_CONFIG_HOME, DBUS_SESSION_BUS_ADDRESS,
          // keyring paths, etc.) to locate stored credentials. Restricting the env
          // like we do for API-key-based adapters breaks auth silently.
          ...scrubCopilotHostileTokens(process.env),
          GIT_AUTHOR_NAME: 'swarm-orchestrator',
          GIT_AUTHOR_EMAIL: 'swarm@localhost',
          GIT_COMMITTER_NAME: 'swarm-orchestrator',
          GIT_COMMITTER_EMAIL: 'swarm@localhost',
          COPILOT_ALLOW_ALL: 'true',
        },
      };

      const proc = spawn(command, args, spawnOpts);

      // Close stdin so the subprocess never blocks on interactive input
      if (proc.stdin) {
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

      const effectiveStallTimeout = timeout || STALL_TIMEOUT_MS;

      stallCheckInterval = setInterval(() => {
        const silentMs = Date.now() - lastOutputTime;
        if (silentMs >= effectiveStallTimeout) {
          cleanup();
          proc.kill('SIGTERM');
          setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch { /* already dead */ }
          }, 5000);
          if (!resolved) {
            resolved = true;
            const stallSec = Math.round(silentMs / 1000);
            resolve({
              stdout,
              stderr: stderr + `\nProcess killed after ${stallSec}s of no output (stall timeout)`,
              exitCode: 1,
            });
          }
        }
      }, 10_000);

      if (proc.stdout) {
        proc.stdout.on('data', (data) => {
          const text = data.toString();
          stdout += text;
          lastOutputTime = Date.now();
        });
      }

      if (proc.stderr) {
        proc.stderr.on('data', (data) => {
          const text = data.toString();
          // Filter scope enforcement noise from captured stderr
          const lines = text.split('\n');
          const filtered = lines.filter((l: string) => !isScopeNoise(l)).join('\n');
          stderr += filtered;
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
          resolve({
            stdout,
            stderr: stderr + '\n' + err.message,
            exitCode: 1,
          });
        }
      });
    });
  }
}
