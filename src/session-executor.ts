import { spawn, SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AgentAdapter } from './adapters/agent-adapter';
import { scrubCopilotHostileTokens } from './adapters/copilot-adapter';
import { scanBaseline } from './baseline-scanner';
import { AgentProfile } from './config-loader';
import { HookGenerator, GeneratedHooks } from './hook-generator';
import { PlanStep } from './plan-generator';
import { redactFile } from './secret-redactor';
import { ExecutionContext } from './step-runner';
import { discoverTestCommand, renderVerifyCommandSection } from './test-command-discovery';
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_QUIET_THRESHOLD_MS,
  DEFAULT_SIGKILL_DELAY_MS,
} from './defaults';
import { getLogger } from './logger';
const logger = getLogger('session-executor');

export interface SessionOptions {
  model?: string | undefined;
  silent?: boolean;
  allowAllTools?: boolean;
  availableTools?: string[];
  mcpConfig?: string;
  agent?: string;
  shareToFile?: string;
  logPrefix?: string; // prefix for live console logs (e.g., "[Agent:Step]")
  useInnerFleet?: boolean; // prefix prompt with /fleet for subagent dispatch
  hooksEnabled?: boolean; // generate per-step hook files for scope enforcement
  hooksRunDir?: string;   // run directory for evidence log output
  hooksExecutionId?: string; // execution ID for hook context
  hooksBranch?: string;   // step branch name for hook context
  additionalEnv?: Record<string, string>; // extra env vars for the spawned process (e.g., COPILOT_HOOKS_DIR)
  additionalArgs?: string[]; // extra CLI args for the copilot subprocess (e.g., --plugin-dir)
  onAgentLine?: (prefixedLine: string) => void; // callback for each output line
  executionMode?: 'cold-start' | 'persistent-interactive' | 'auto';
  persistentSessionId?: string;
  persistentTurnTimeoutMs?: number;
}

export interface SessionResult {
  success: boolean;
  output: string;
  error?: string;
  transcriptPath?: string;
  exitCode: number;
  duration: number;
  /**
   * Instrumented count of premium API requests reported by the underlying
   * CLI tool (e.g. Copilot's "Requests N Premium" stderr summary).
   * undefined when the tool produced no such marker — callers must not
   * silently assume 1.
   */
  premiumRequestsConsumed?: number | undefined;
}

/**
 * Executes GitHub Copilot CLI sessions programmatically
 * Uses the real `copilot -p` command with automation flags
 */
export class SessionExecutor {
  private copilotBin: string;
  private workingDir: string;
  private adapter: AgentAdapter | undefined;

  // Copilot CLI outputs these when an agent tries to access paths outside its sandbox.
  // Expected behavior during scoped execution; noisy and confusing to users.
  private static readonly SCOPE_NOISE_PATTERNS = [
    /Permission denied and could not request permission/i,
    /could not request permission from user/i,
  ];

  constructor(workingDir?: string, adapter?: AgentAdapter) {
    this.copilotBin = 'copilot';
    this.workingDir = workingDir || process.cwd();
    this.adapter = adapter;
  }

  private isScopeEnforcementNoise(line: string): boolean {
    return SessionExecutor.SCOPE_NOISE_PATTERNS.some(p => p.test(line));
  }

  /**
   * Execute a Copilot CLI session with a prompt
   * Returns full output and transcript path if --share used
   */
  async executeSession(
    prompt: string,
    options: SessionOptions = {}
  ): Promise<SessionResult> {
    // When an adapter is set, delegate to it instead of the hardcoded copilot path.
    // This lets non-Copilot tools (Claude Code, Codex) plug in transparently.
    if (this.adapter) {
      return this.executeViaAdapter(prompt, options);
    }

    const startTime = Date.now();

    // build command args based on real copilot CLI flags
    const args: string[] = ['-p', prompt];

    if (options.model) {
      args.push('--model', options.model);
    }

    if (options.silent) {
      args.push('--silent');
    }

    if (options.allowAllTools) {
      // --allow-all covers tools, paths, and URLs so the subprocess
      // never blocks waiting for interactive approval on stdin.
      args.push('--allow-all');
    }

    if (options.availableTools && options.availableTools.length > 0) {
      args.push('--available-tools', ...options.availableTools);
    }

    if (options.mcpConfig) {
      args.push('--additional-mcp-config', options.mcpConfig);
    }

    if (options.agent) {
      args.push('--agent', options.agent);
    }

    if (options.shareToFile) {
      args.push('--share', options.shareToFile);
    }

    // Append any extra CLI args (e.g., --plugin-dir from hook injection)
    if (options.additionalArgs && options.additionalArgs.length > 0) {
      args.push(...options.additionalArgs);
    }

    // execute copilot command with optional log prefix for parallelism visibility
    const result = await this.runCommand(this.copilotBin, args, options.logPrefix, options.additionalEnv, options.onAgentLine);

    const duration = Date.now() - startTime;

    return {
      success: result.exitCode === 0,
      output: result.stdout + result.stderr,
      error: result.exitCode !== 0 ? result.stderr : undefined,
      transcriptPath: options.shareToFile && result.exitCode === 0 ? options.shareToFile : undefined,
      exitCode: result.exitCode,
      duration
    } as SessionResult;
  }

  /**
   * Delegate session execution to the pluggable adapter.
   * Maps SessionOptions to AgentSpawnOptions and AgentResult back to SessionResult.
   */
  private async executeViaAdapter(
    prompt: string,
    options: SessionOptions
  ): Promise<SessionResult> {
    const agentResult = await this.adapter!.spawn({
      prompt,
      workdir: this.workingDir,
      model: options.model,
      copilotAgent: options.agent,
      executionMode: options.executionMode,
      persistentSessionId: options.persistentSessionId,
      persistentTurnTimeoutMs: options.persistentTurnTimeoutMs,
      onAgentLine: options.onAgentLine,
    });

    // Write transcript to the share file if the adapter produced one,
    // or if the caller requested shareToFile. Always capture output even on
    // non-zero exit so the verification pipeline can inspect agent work.
    // For non-Copilot adapters shareTranscriptPath is always undefined,
    // so we generate a fallback transcript from stdout.
    let transcriptPath: string | undefined;
    if (agentResult.shareTranscriptPath) {
      transcriptPath = agentResult.shareTranscriptPath;
    } else if (options.shareToFile) {
      const dir = path.dirname(options.shareToFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Include stderr when stdout is empty so diagnostic messages
      // (e.g. model-not-available errors that slip through) are visible
      const transcriptBody = agentResult.stdout
        || (agentResult.stderr ? `stderr:\n${agentResult.stderr}` : 'No output captured');
      fs.writeFileSync(
        options.shareToFile,
        `# Agent Session Transcript\n\nSession output:\n\`\`\`\n${transcriptBody}\n\`\`\`\n`,
        'utf8'
      );
      transcriptPath = options.shareToFile;
    }

    // Scrub known secret values from the transcript before anything reads it
    if (transcriptPath) {
      redactFile(transcriptPath);
    }

    const sessionResult: SessionResult = {
      success: agentResult.exitCode === 0,
      output: agentResult.stdout + agentResult.stderr,
      exitCode: agentResult.exitCode,
      duration: agentResult.durationMs,
      premiumRequestsConsumed: agentResult.premiumRequestsConsumed,
    };
    if (agentResult.exitCode !== 0) {
      sessionResult.error = agentResult.stderr;
    }
    if (transcriptPath) {
      sessionResult.transcriptPath = transcriptPath;
    }
    return sessionResult;
  }

  /**
   * Execute a step with automatic session creation
   * Includes human-like commit instructions
   */
  async executeStep(
    step: PlanStep,
    agent: AgentProfile,
    context: ExecutionContext,
    options: SessionOptions = {}
  ): Promise<SessionResult> {
    // generate comprehensive prompt with human-like commit instructions
    let prompt = this.buildStepPrompt(step, agent, context);

    // /fleet prefix for inner parallelism when enabled
    if (options.useInnerFleet) {
      prompt = `/fleet ${prompt}`;
    }

    // Generate per-step hooks for scope enforcement and evidence capture
    let generatedHooks: GeneratedHooks | undefined;
    if (options.hooksEnabled && options.hooksRunDir) {
      const hookGen = new HookGenerator();
      generatedHooks = hookGen.generateStepHooks({
        step,
        agent,
        executionId: options.hooksExecutionId || 'unknown',
        runDir: options.hooksRunDir,
        stepBranch: options.hooksBranch || `step-${step.stepNumber}`,
        workingDir: this.workingDir
      });
    }

    // set up transcript path
    const transcriptPath = path.join(
      this.workingDir,
      'proof',
      `step-${step.stepNumber}-${agent.name.toLowerCase()}.md`
    );

    // ensure proof directory exists
    const proofDir = path.dirname(transcriptPath);
    if (!fs.existsSync(proofDir)) {
      fs.mkdirSync(proofDir, { recursive: true });
    }

    // Hooks are auto-loaded by Copilot CLI from <gitRoot>/.github/hooks/
    // No additional args needed; the hook file was written to workingDir.

    // merge options with defaults
    const sessionOptions: SessionOptions = {
      silent: false,
      allowAllTools: true, // enable git, npm, test commands
      shareToFile: transcriptPath,
      ...options
    };

    try {
      const result = await this.executeSession(prompt, sessionOptions);

      // Attach evidence log path to the result for verifier consumption
      if (generatedHooks) {
        (result as SessionResult & { evidenceLogPath?: string }).evidenceLogPath = generatedHooks.evidenceLogPath;
      }

      return result;
    } finally {
      // Cleanup hook files (evidence log in runDir persists)
      if (generatedHooks) {
        const hookGen = new HookGenerator();
        hookGen.cleanupHooks(generatedHooks.hooksFilePath);
      }
    }
  }

  /**
   * Build comprehensive step prompt with human-like commit guidance
   */
  private buildStepPrompt(
    step: PlanStep,
    agent: AgentProfile,
    context: ExecutionContext
  ): string {
    const sections: string[] = [];

    sections.push('=== COPILOT CLI SESSION - Step ' + step.stepNumber + ' ===\n');

    sections.push('You are operating as a GitHub Copilot CLI custom agent within a supervised,');
    sections.push('sequential workflow.\n');

    sections.push('Context');
    sections.push('-------');
    sections.push('- This repository is: ' + context.plan.goal);
    sections.push('- Execution ID: ' + context.executionId);
    sections.push('- Step: ' + step.stepNumber + ' of ' + context.plan.steps.length);
    sections.push('- Your work must be fully auditable through session transcripts, git history,');
    sections.push('  and test output.\n');

    sections.push('Your assigned role');
    sections.push('------------------');
    sections.push('- Agent name: ' + agent.name);
    sections.push('- Domain scope: ' + agent.purpose);
    sections.push('- You must stay strictly within this domain.');
    sections.push('- If a task exceeds this scope, say so and stop.\n');

    sections.push('Your specific task for this step');
    sections.push('---------------------------------');
    sections.push(step.task + '\n');

    sections.push('Scope (what you ARE responsible for)');
    sections.push('-------------------------------------');
    agent.scope.forEach(item => {
      sections.push('- ' + item);
    });
    sections.push('');

    sections.push('Boundaries (what you should NOT do)');
    sections.push('-----------------------------------');
    agent.boundaries.forEach(item => {
      sections.push('- ' + item);
    });
    sections.push('');

    // Surface existing test files so agents know what not to break
    const baseline = scanBaseline(this.workingDir);
    if (baseline.testFiles.length > 0) {
      sections.push('EXISTING TESTS (must still pass after your changes)');
      sections.push('---------------------------------------------------');
      for (const f of baseline.testFiles) {
        sections.push('- ' + f);
      }
      sections.push('');
    }

    // Discover the target project's full test gate so the agent runs
    // `pnpm test` (or equivalent) instead of a subset like `npx vitest --run`
    // that would skip lint and type checks.
    const testDiscovery = discoverTestCommand(this.workingDir);
    if (testDiscovery.warning) {
      logger.warn(`test command discovery: ${testDiscovery.warning}`);
    }
    sections.push(renderVerifyCommandSection(testDiscovery));

    // CRITICAL: Human-like commit instructions
    sections.push('Git Commit Requirements (CRITICAL)');
    sections.push('-----------------------------------');
    sections.push('Make INCREMENTAL commits throughout your work, not one giant commit at the end.');
    sections.push('');
    sections.push('Each commit message must be:');
    sections.push('- Natural and human-written (avoid AI patterns like perfect grammar or templates)');
    sections.push('- Descriptive and imperative ("add feature" not "added feature")');
    sections.push('- Contextual and specific to what changed');
    sections.push('- Varied in style (mix of conventional-commits, casual, technical)');
    sections.push('');
    sections.push('Good commit message examples:');
    sections.push('  "add user authentication module"');
    sections.push('  "fix: handle edge case in validator"');
    sections.push('  "update deps and tweak config"');
    sections.push('  "implement todo list component with tests"');
    sections.push('  "refactor api client, clean up error handling"');
    sections.push('');
    sections.push('Commit frequently in logical chunks:');
    sections.push('  git add <files>');
    sections.push('  git commit -m "your natural message"');
    sections.push('');
    sections.push('Feel free to tweak configs (package.json, tsconfig.json, etc.) and commit them naturally.');
    sections.push('');

    sections.push('Hard rules');
    sections.push('----------');
    sections.push('1. Do not invent features, flags, APIs, or tool behavior.');
    sections.push('2. If you are uncertain about anything, explicitly say you are uncertain');
    sections.push('   and list how to verify it.');
    sections.push('3. Do not claim tests passed unless you actually ran them and can show');
    sections.push('   the command output.');
    sections.push('4. Do not say "done" unless all required artifacts exist.');
    sections.push('5. Prefer small, reviewable changes over large refactors.');
    sections.push('6. Make multiple small commits with varied, natural messages.');
    sections.push('7. ALWAYS verify your branch before committing: git branch --show-current\n');

    sections.push('Quality bar (applies when relevant to your scope)');
    sections.push('-----------------------------------------------');
    sections.push('- Extract-before-repeat: if you copy the same logic more than twice, stop and refactor into a shared util/hook/middleware.');
    sections.push('- Config-first: do not hardcode API base URLs, timeouts, retry counts, or environment-specific values. Prefer env vars or a typed config module.');
    sections.push('- README truth: do not claim features that are not implemented. If you are unsure, downgrade the claim and include how to verify.');
    sections.push('- Keep it boring and verifiable: request logging, correlation id propagation, and consistent error responses when building HTTP APIs.');
    sections.push('- For frontends: use a real HTML title, include responsive meta viewport, and centralize fetch error handling (retry/backoff only if implemented).');
    sections.push('');

    sections.push('Code comments (Required)');
    sections.push('------------------------');
    sections.push('- Add a 1-2 line purpose comment at top of each new file');
    sections.push('- Add brief inline comments for non-obvious logic');
    sections.push('- Use natural, casual language - not robotic/formal');
    sections.push('- Good: "// bail early if no items"');
    sections.push('- Bad: "// This conditional statement checks if the array is empty..."');
    sections.push('- For functions: brief docstring explaining purpose\n');

    sections.push('Refusal rules (when to stop and ask)');;
    sections.push('-------------------------------------');
    agent.refusal_rules.forEach(rule => {
      sections.push('- ' + rule);
    });
    sections.push('');

    if (step.dependencies.length > 0) {
      sections.push('Dependencies (steps you can rely on)');
      sections.push('------------------------------------');
      sections.push('This step depends on: Steps ' + step.dependencies.join(', '));

      if (context.priorContext.length > 0) {
        sections.push('');
        sections.push('Context from prior steps:');
        context.priorContext.forEach(ctx => {
          sections.push('  ' + ctx);
        });
      }
      sections.push('');
    }

    sections.push('Done definition (when you can say "done")');
    sections.push('------------------------------------------');
    agent.done_definition.forEach(item => {
      sections.push('- ' + item);
    });
    sections.push('');

    sections.push('Required artifacts for this step');
    sections.push('--------------------------------');
    sections.push('1. Implementation changes (code, config, etc.)');
    sections.push('2. Multiple small commits with varied, natural messages');
    sections.push('3. A verification section that includes:');
    sections.push('   - What commands you ran');
    sections.push('   - What tests were executed');
    sections.push('   - The results of those tests');
    sections.push('   - Any gaps or risks that remain');
    sections.push('');
    sections.push('Expected outputs:');
    step.expectedOutputs.forEach(output => {
      sections.push('   - ' + output);
    });
    sections.push('');

    sections.push('If any requirement cannot be met, stop and explain why before proceeding.');
    sections.push('');
    sections.push('=== BEGIN WORK ===');

    return sections.join('\n');
  }

  /**
   * Run a command and capture output.
   * Uses line buffering to prevent mid-word breaks when streaming output.
   * Each complete line gets prefixed with [Agent:Step] for parallelism visibility.
   * A heartbeat indicator prints during quiet periods so users know the agent
   * is still working (e.g. reading large files or thinking).
   */
  // Maximum seconds of silence before killing a stalled subprocess.
  // Copilot CLI can go quiet for several minutes during extended tool-use
  // or thinking phases, so this needs headroom beyond typical inference time.
  private static readonly STALL_TIMEOUT_MS = DEFAULT_COMMAND_TIMEOUT_MS * 2 + 60_000;

  private runCommand(
    command: string,
    args: string[],
    logPrefix?: string,
    additionalEnv?: Record<string, string>,
    onAgentLine?: (prefixedLine: string) => void
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const options: SpawnOptions = {
        cwd: this.workingDir,
        env: {
          ...scrubCopilotHostileTokens(process.env),
          // ensure copilot can authenticate
          COPILOT_ALLOW_ALL: 'true',
          ...additionalEnv
        }
      };

      const proc = spawn(command, args, options);

      // Close stdin immediately so the subprocess never blocks waiting for
      // interactive input. Non-interactive mode should never need stdin.
      if (proc.stdin) {
        proc.stdin.end();
      }

      let stdout = '';
      let stderr = '';
      let resolved = false;

      // line buffers prevent mid-word breaks in streamed output
      let stdoutBuffer = '';
      let stderrBuffer = '';

      // Heartbeat: print activity status during quiet periods (no output for 10s)
      let lineCount = 0;
      let lastOutputTime = Date.now();
      const cmdStartTime = Date.now();
      let heartbeatInterval: NodeJS.Timeout | null = null;
      let stallCheckInterval: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        if (stallCheckInterval) clearInterval(stallCheckInterval);
      };

      // Stall detection: kill subprocess if no output for STALL_TIMEOUT_MS
      stallCheckInterval = setInterval(() => {
        const silentMs = Date.now() - lastOutputTime;
        if (silentMs >= SessionExecutor.STALL_TIMEOUT_MS) {
          const elapsed = Math.round((Date.now() - cmdStartTime) / 1000);
          const stallSec = Math.round(silentMs / 1000);
          if (logPrefix) {
            logger.info(`${logPrefix} STALL DETECTED: no output for ${stallSec}s (total ${elapsed}s, ${lineCount} lines). Killing process.`);
          }
          cleanup();
          proc.kill('SIGTERM');
          // give it 5s to exit gracefully, then force kill
          setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch { /* already dead */ }
          }, DEFAULT_SIGKILL_DELAY_MS);
          if (!resolved) {
            resolved = true;
            resolve({
              stdout,
              stderr: stderr + `\nProcess killed after ${stallSec}s of no output (stall timeout)`,
              exitCode: 1
            });
          }
        }
      }, DEFAULT_HEARTBEAT_QUIET_THRESHOLD_MS);

      if (logPrefix) {
        heartbeatInterval = setInterval(() => {
          const silentMs = Date.now() - lastOutputTime;
          if (silentMs >= DEFAULT_HEARTBEAT_QUIET_THRESHOLD_MS) {
            const elapsed = Math.round((Date.now() - cmdStartTime) / 1000);
            logger.info(`${logPrefix} ... still working (${elapsed}s, ${lineCount} lines so far)`);
            lastOutputTime = Date.now(); // reset so we don't spam
          }
        }, DEFAULT_HEARTBEAT_INTERVAL_MS);
      }

      if (proc.stdout) {
        proc.stdout.on('data', (data) => {
          const text = data.toString();
          stdout += text;
          lastOutputTime = Date.now();

          // buffer partial lines, only print complete ones
          if (logPrefix) {
            stdoutBuffer += text;
            const lines = stdoutBuffer.split('\n');
            // keep last (possibly incomplete) line in buffer
            stdoutBuffer = lines.pop() || '';
            // print complete lines with prefix
            for (const line of lines) {
              if (line.trim() && !this.isScopeEnforcementNoise(line)) {
                lineCount++;
                const prefixed = `${logPrefix} ${line}`;
                logger.info(prefixed);
                if (onAgentLine) onAgentLine(prefixed);
              }
            }
          }
        });
      }

      if (proc.stderr) {
        proc.stderr.on('data', (data) => {
          const text = data.toString();
          stderr += text;
          lastOutputTime = Date.now();

          // buffer partial lines, only print complete ones
          if (logPrefix) {
            stderrBuffer += text;
            const lines = stderrBuffer.split('\n');
            // keep last (possibly incomplete) line in buffer
            stderrBuffer = lines.pop() || '';
            // print complete lines with prefix
            for (const line of lines) {
              if (line.trim() && !this.isScopeEnforcementNoise(line)) {
                lineCount++;
                const prefixed = `${logPrefix} ${line}`;
                logger.error(prefixed);
                if (onAgentLine) onAgentLine(prefixed);
              }
            }
          }
        });
      }

      proc.on('close', (code) => {
        cleanup();

        // flush any remaining buffered content
        if (logPrefix) {
          if (stdoutBuffer.trim()) {
            lineCount++;
            logger.info(`${logPrefix} ${stdoutBuffer}`);
          }
          if (stderrBuffer.trim()) {
            lineCount++;
            logger.error(`${logPrefix} ${stderrBuffer}`);
          }
        }

        if (!resolved) {
          resolved = true;
          resolve({
            stdout,
            stderr,
            exitCode: code || 0
          });
        }
      });

      proc.on('error', (err) => {
        cleanup();

        // flush buffers on error too
        if (logPrefix) {
          if (stdoutBuffer.trim()) {
            logger.info(`${logPrefix} ${stdoutBuffer}`);
          }
          if (stderrBuffer.trim()) {
            logger.error(`${logPrefix} ${stderrBuffer}`);
          }
        }

        if (!resolved) {
          resolved = true;
          resolve({
            stdout,
            stderr: stderr + '\n' + err.message,
            exitCode: 1
          });
        }
      });
    });
  }

  /**
   * Retry a session execution up to N times on failure
   */
  async executeWithRetry(
    prompt: string,
    options: SessionOptions = {},
    maxRetries: number = 3
  ): Promise<SessionResult> {
    let lastResult: SessionResult | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      lastResult = await this.executeSession(prompt, options);

      if (lastResult.success) {
        return lastResult;
      }

      if (attempt < maxRetries) {
        logger.error(`Attempt ${attempt} failed, retrying... (${maxRetries - attempt} left)`);
        // wait before retry (exponential backoff)
        await this.sleep(Math.pow(2, attempt) * 1000);
      }
    }

    return lastResult as SessionResult;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default SessionExecutor;
