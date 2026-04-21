/**
 * Copilot CLI Wrapper
 *
 * Abstraction layer for resilient Copilot CLI invocation with:
 * - Graceful degradation when CLI unavailable
 * - Fallback to alternative modes
 * - Better error handling and retry logic
 * - Feature detection and capability checking
 */

import { spawn } from 'child_process';
import { getLogger } from './logger';
const logger = getLogger('copilot-cli-wrapper');

export interface CliCapabilities {
  available: boolean;
  version?: string;
  supportsPromptMode: boolean;
  supportsShare: boolean;
  supportsAgents: boolean;
  supportsMcp: boolean;
}

export interface WrapperOptions {
  gracefulDegradation?: boolean;
  retryOnFailure?: boolean;
  maxRetries?: number;
  timeout?: number;
  strictIsolation?: boolean; // force per-task branches, transcript-only context
  useInnerFleet?: boolean;   // prefix prompts with /fleet
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string | undefined;
  exitCode: number;
  degraded: boolean; // true if fallback mode was used
  capabilities: CliCapabilities;
}

/**
 * Wrapper for GitHub Copilot CLI with resilience features
 */
export class CopilotCliWrapper {
  private capabilities: CliCapabilities | null = null;
  private capabilityCheckDone = false;

  constructor(private options: WrapperOptions = {}) {
    // Default options
    this.options.gracefulDegradation = this.options.gracefulDegradation ?? true;
    this.options.retryOnFailure = this.options.retryOnFailure ?? true;
    this.options.maxRetries = this.options.maxRetries ?? 3;
    this.options.timeout = this.options.timeout ?? 300000; // 5 minutes
  }

  /**
   * Check if Copilot CLI is available and what features it supports
   */
  async checkCapabilities(): Promise<CliCapabilities> {
    if (this.capabilityCheckDone && this.capabilities) {
      return this.capabilities;
    }

    const capabilities: CliCapabilities = {
      available: false,
      supportsPromptMode: false,
      supportsShare: false,
      supportsAgents: false,
      supportsMcp: false
    };

    try {
      // Check if copilot command exists
      const versionResult = await this.runCommand('copilot', ['--version'], { timeout: 5000 });

      if (versionResult.exitCode === 0) {
        capabilities.available = true;
        capabilities.version = versionResult.stdout.trim();

        // Check for -p flag support
        const helpResult = await this.runCommand('copilot', ['--help'], { timeout: 5000 });
        capabilities.supportsPromptMode = helpResult.stdout.includes('-p');
        capabilities.supportsShare = helpResult.stdout.includes('--share');
        capabilities.supportsAgents = helpResult.stdout.includes('--agent');
        capabilities.supportsMcp = helpResult.stdout.includes('--mcp');
      }
    } catch {
      // CLI not available
      capabilities.available = false;
    }

    this.capabilities = capabilities;
    this.capabilityCheckDone = true;
    return capabilities;
  }

  /**
   * Execute a Copilot CLI command with resilience
   */
  async execute(
    args: string[],
    options: { cwd?: string; input?: string } = {}
  ): Promise<ExecutionResult> {
    // Strict isolation guard: log when active so transcript captures the mode
    if (this.options.strictIsolation) {
      logger.info('[strict-isolation] Per-task branch isolation active. Context restricted to transcript evidence only.');
    }

    // Inner fleet toggle: prepend /fleet to prompt input
    if (this.options.useInnerFleet && options.input) {
      logger.info('[inner-fleet] Inner fleet mode active. External safety rail enforced.');
      options = { ...options, input: `/fleet ${options.input}` };
    }

    const capabilities = await this.checkCapabilities();

    if (!capabilities.available) {
      if (this.options.gracefulDegradation) {
        return this.degradedExecution(args, options);
      } else {
        return {
          success: false,
          output: '',
          error: 'Copilot CLI is not available. Please install it with: npm install -g @github/copilot',
          exitCode: 127,
          degraded: false,
          capabilities
        };
      }
    }

    // Execute with retries
    let lastError: string = '';
    for (let attempt = 1; attempt <= (this.options.maxRetries || 1); attempt++) {
      try {
        const runOptions: { cwd?: string; timeout?: number; input?: string } = {};
        if (options.cwd) runOptions.cwd = options.cwd;
        if (this.options.timeout) runOptions.timeout = this.options.timeout;
        if (options.input) runOptions.input = options.input;

        const result = await this.runCommand('copilot', args, runOptions);

        return {
          success: result.exitCode === 0,
          output: result.stdout + result.stderr,
          error: result.exitCode !== 0 ? result.stderr : undefined,
          exitCode: result.exitCode,
          degraded: false,
          capabilities
        };
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : String(error);

        if (attempt < (this.options.maxRetries || 1)) {
          // Wait before retry with exponential backoff
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    // All retries failed
    if (this.options.gracefulDegradation) {
      return this.degradedExecution(args, options);
    }

    return {
      success: false,
      output: '',
      error: `Failed after ${this.options.maxRetries} attempts: ${lastError}`,
      exitCode: 1,
      degraded: false,
      capabilities
    };
  }

  /**
   * Degraded execution mode when CLI unavailable or failing
   * Provides helpful guidance instead of hard failure
   */
  private degradedExecution(
    args: string[],
    options: { cwd?: string; input?: string }
  ): ExecutionResult {
    const capabilities = this.capabilities || {
      available: false,
      supportsPromptMode: false,
      supportsShare: false,
      supportsAgents: false,
      supportsMcp: false
    };

    // Generate helpful message based on what was attempted
    let message = '⚠️  Graceful Degradation Mode\n\n';
    message += 'The Copilot CLI is not available or failed to execute.\n';
    message += 'This would have run: copilot ' + args.join(' ') + '\n\n';

    if (options.input) {
      message += 'With prompt:\n';
      message += '---\n';
      message += options.input.substring(0, 500);
      if (options.input.length > 500) {
        message += '\n... (truncated)';
      }
      message += '\n---\n\n';
    }

    message += 'To use this feature:\n';
    message += '1. Install Copilot CLI: npm install -g @github/copilot\n';
    message += '2. Authenticate: copilot auth\n';
    message += '3. Re-run this command\n\n';
    message += 'Or, execute the prompt manually in your terminal.';

    return {
      success: false,
      output: message,
      error: 'Copilot CLI not available (degraded mode)',
      exitCode: 0, // Don't fail hard
      degraded: true,
      capabilities
    };
  }

  /**
   * Run a command and capture output
   */
  protected runCommand(
    command: string,
    args: string[],
    options: { cwd?: string; timeout?: number; input?: string } = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        cwd: options.cwd || process.cwd(),
        shell: true
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Set timeout if specified
      const timeoutId = options.timeout
        ? setTimeout(() => {
            timedOut = true;
            proc.kill('SIGTERM');
          }, options.timeout)
        : null;

      if (proc.stdout) {
        proc.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }

      if (proc.stderr) {
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      // Send input if provided
      if (options.input && proc.stdin) {
        proc.stdin.write(options.input);
        proc.stdin.end();
      }

      proc.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId);

        if (timedOut) {
          resolve({
            stdout,
            stderr: stderr + '\nCommand timed out',
            exitCode: 124
          });
        } else {
          resolve({
            stdout,
            stderr,
            exitCode: code || 0
          });
        }
      });

      proc.on('error', (err) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({
          stdout,
          stderr: stderr + '\n' + err.message,
          exitCode: 127
        });
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current capabilities (cached)
   */
  getCapabilities(): CliCapabilities | null {
    return this.capabilities;
  }

  /**
   * Reset capability cache (for testing)
   */
  resetCapabilities(): void {
    this.capabilities = null;
    this.capabilityCheckDone = false;
  }
}

export default CopilotCliWrapper;
