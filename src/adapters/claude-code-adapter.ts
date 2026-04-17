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

    // D5: Parse premium request count from Claude Code CLI output.
    // Claude Code prints a cost/usage summary that we can extract.
    // Fallback: count conversation turns (each assistant response = 1 request).
    const premiumRequestsConsumed = this.parseRequestCount(result.stdout, result.stderr);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs,
      premiumRequestsConsumed,
    };
  }

  /**
   * D5: Extract the number of premium API requests from Claude Code output.
   * Claude Code outputs conversation turn markers and cost summaries.
   * We count distinct assistant response blocks as a proxy for API calls.
   * Returns undefined if parsing fails — caller must not default to an
   * un-calibrated estimate without logging a warning.
   */
  private parseRequestCount(stdout: string, stderr: string): number | undefined {
    // Strategy 1: Look for explicit cost/usage lines in stderr
    // Claude Code may print "Total cost: $X.XX" or similar
    const costMatch = stderr.match(/total\s+cost.*?\$(\d+\.\d+)/i)
      || stdout.match(/total\s+cost.*?\$(\d+\.\d+)/i);
    // If we find a dollar cost, each Sonnet request ≈ $0.01-0.03
    // but this is unreliable for counting discrete requests.

    // Strategy 2: Count conversation turns in the output.
    // Claude Code CLI in -p mode makes one request and returns one response.
    // In multi-turn sessions, each "Human:"→"Assistant:" pair = 1 request.
    const turnMarkers = stdout.match(/^(Human|User):/gm);
    if (turnMarkers && turnMarkers.length > 0) {
      return turnMarkers.length;
    }

    // Strategy 3: If the CLI ran at all, it consumed at least 1 request.
    // A non-empty stdout from a successful run means 1 API call minimum.
    if (stdout.trim().length > 0) {
      return 1;
    }

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
