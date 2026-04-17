// Claude Code CLI adapter: spawns `claude` with --dangerously-skip-permissions
// for non-interactive use. No transcript sharing; stdout/stderr captured directly.

import { spawn, SpawnOptions } from 'child_process';
import { AgentAdapter, AgentResult, AgentSpawnOptions, buildRestrictedEnv } from './agent-adapter';

// Claude Code can spend several minutes on internal reasoning and multi-file
// operations without producing stdout, unlike streaming CLI tools.
const STALL_TIMEOUT_MS = 600_000;

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = 'claude-code';

  async spawn(opts: AgentSpawnOptions): Promise<AgentResult> {
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

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs,
    };
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
