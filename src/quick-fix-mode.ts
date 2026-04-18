/**
 * Quick-Fix Mode
 *
 * Bypasses full swarm orchestration for simple, single-agent tasks.
 * Provides faster execution for:
 * - Single file changes
 * - Documentation updates
 * - Bug fixes
 * - Simple refactoring
 *
 * Uses heuristics to determine if a task is "quick-fix eligible"
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentProfile, ConfigLoader } from './config-loader';
import SessionExecutor, { SessionOptions, SessionResult } from './session-executor';
import VerifierEngine from './verifier-engine';
import { getLogger } from './logger';
const logger = getLogger('quick-fix-mode');

export interface QuickFixOptions {
  model?: string;
  agent?: string; // Optional: specify agent, otherwise auto-detect
  skipVerification?: boolean; // Skip verification for super-fast mode
  workingDir?: string;
}

export interface QuickFixResult {
  success: boolean;
  agentUsed: string;
  sessionResult?: SessionResult;
  verificationPassed?: boolean;
  output: string;
  duration: number;
  wasQuickFixEligible: boolean;
  reason?: string; // Why it was/wasn't eligible
}

/**
 * Quick-fix mode for single-agent bypass
 */
export class QuickFixMode {
  private configLoader: ConfigLoader;
  private sessionExecutor: SessionExecutor;
  private verifier: VerifierEngine;

  constructor(workingDir?: string) {
    this.configLoader = new ConfigLoader();
    this.sessionExecutor = new SessionExecutor(workingDir);
    this.verifier = new VerifierEngine(workingDir);
  }

  /**
   * Determine if a task is eligible for quick-fix mode
   */
  isQuickFixEligible(task: string): { eligible: boolean; reason: string; suggestedAgent?: string } {
    const taskLower = task.toLowerCase();

    // Indicators that suggest quick-fix is appropriate
    const quickFixPatterns = [
      { pattern: /^(fix|update|change|modify)\s+(a|an|the)?\s*single\s+file/i, agent: 'backend_master', reason: 'Single file modification' },
      { pattern: /^update\s+(readme|documentation|docs?|changelog)/i, agent: 'integrator_finalizer', reason: 'Documentation update' },
      { pattern: /^fix\s+(typo|spelling|grammar)/i, agent: 'integrator_finalizer', reason: 'Typo fix' },
      { pattern: /^add\s+(comment|comments|docstring)/i, agent: 'backend_master', reason: 'Adding comments' },
      { pattern: /^remove\s+(unused|dead)\s+code/i, agent: 'backend_master', reason: 'Code cleanup' },
      { pattern: /^rename\s+(variable|function|class|file)/i, agent: 'backend_master', reason: 'Renaming' },
      { pattern: /^fix\s+linting?\s+(error|warning)/i, agent: 'backend_master', reason: 'Linting fix' },
      { pattern: /^update\s+(dependency|package|version)/i, agent: 'backend_master', reason: 'Dependency update' },
      { pattern: /^fix\s+simple\s+bug/i, agent: 'backend_master', reason: 'Simple bug fix' }
    ];

    for (const { pattern, agent, reason } of quickFixPatterns) {
      if (pattern.test(task)) {
        return { eligible: true, reason, suggestedAgent: agent };
      }
    }

    // Indicators that suggest full swarm is needed
    const fullSwarmPatterns = [
      { pattern: /\band\b/g, reason: 'Multiple tasks in one request', checkCount: true }, // Check this FIRST
      { pattern: /multiple\s+(files|components|modules|services)/i, reason: 'Multiple components involved' },
      { pattern: /\b(architecture|design|refactor|restructure)\b/i, reason: 'Architectural change needed' },
      { pattern: /\b(implement|build|create)\s+.*(feature|system|module|service)\b/i, reason: 'New feature implementation' },
      { pattern: /\b(test|testing|e2e|integration)\b.*\b(suite|coverage|framework)\b/i, reason: 'Comprehensive testing needed' },
      { pattern: /\b(deploy|deployment|ci\/cd|pipeline)\b/i, reason: 'Deployment/infrastructure work' },
      { pattern: /\b(security|audit|vulnerability)\b.*\b(review|scan|check)\b/i, reason: 'Security review needed' }
    ];

    for (const item of fullSwarmPatterns) {
      const { pattern, reason } = item;
      if (pattern.test(taskLower)) {
        // Special case: count "and"s
        if ('checkCount' in item && item.checkCount) {
          const andCount = (taskLower.match(/\band\b/g) || []).length;
          if (andCount >= 3) { // 3 or more "and"s means 4+ tasks
            return { eligible: false, reason: `Multiple tasks detected (${andCount} "and"s)` };
          }
          // Otherwise, 1-2 "and"s is ok, continue checking other patterns
          continue;
        }

        return { eligible: false, reason };
      }
    }

    // Default: if task is short and simple, allow quick-fix
    if (task.length < 100 && task.split(' ').length < 15) {
      return {
        eligible: true,
        reason: 'Task is short and simple',
        suggestedAgent: 'backend_master' // default agent
      };
    }

    return {
      eligible: false,
      reason: 'Task complexity suggests full swarm orchestration'
    };
  }

  /**
   * Execute a task in quick-fix mode
   */
  async execute(task: string, options: QuickFixOptions = {}): Promise<QuickFixResult> {
    const startTime = Date.now();

    // Check eligibility
    const eligibility = this.isQuickFixEligible(task);

    if (!eligibility.eligible) {
      return {
        success: false,
        agentUsed: 'none',
        output: `⚠️  Quick-fix mode not recommended for this task.\nReason: ${eligibility.reason}\n\nUse full swarm mode instead:\n  swarm plan "${task}"\n  swarm swarm plan.json`,
        duration: Date.now() - startTime,
        wasQuickFixEligible: false,
        reason: eligibility.reason
      };
    }

    // Determine which agent to use
    const agentName = options.agent || eligibility.suggestedAgent || 'backend_master';

    let agentProfile: AgentProfile | undefined;
    try {
      const agents = await this.configLoader.loadAllAgents();
      agentProfile = agents.find((a: AgentProfile) =>
        a.name === agentName || ConfigLoader.normalizeAgentName(a.name) === ConfigLoader.normalizeAgentName(agentName)
      );

      if (!agentProfile) {
        return {
          success: false,
          agentUsed: agentName,
          output: `Agent "${agentName}" not found. Available agents: ${agents.map(a => a.name).join(', ')}`,
          duration: Date.now() - startTime,
          wasQuickFixEligible: true,
          reason: 'Agent not found'
        };
      }
    } catch (error: unknown) {
      return {
        success: false,
        agentUsed: agentName,
        output: `Failed to load agents: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
        wasQuickFixEligible: true,
        reason: error instanceof Error ? error.message : String(error)
      };
    }

    logger.info(`⚡ Quick-fix mode: ${eligibility.reason}`);
    logger.info(`   Agent: ${agentProfile.name}`);
    logger.info(`   Task: ${task}\n`);

    // Build prompt for the agent
    const prompt = this.buildQuickFixPrompt(task, agentProfile);

    // Set up session options
    const workingDir = options.workingDir || process.cwd();
    const transcriptPath = path.join(workingDir, '.quickfix', `quickfix-${Date.now()}.md`);

    // Ensure .quickfix directory exists
    const quickfixDir = path.dirname(transcriptPath);
    if (!fs.existsSync(quickfixDir)) {
      fs.mkdirSync(quickfixDir, { recursive: true });
    }

    // Only use --agent flag if the agent file exists in the target repo
    const agentSlug = agentProfile.name.toLowerCase().replace(/\s+/g, '_');
    const agentFilePath = path.join(workingDir, '.github', 'agents', `${agentSlug}.agent.md`);
    const agentFileExists = fs.existsSync(agentFilePath);

    const sessionOptions: SessionOptions = {
      shareToFile: transcriptPath,
      allowAllTools: true,
      silent: false,
      logPrefix: `[${agentProfile.name}]`
    };

    // Only pass --agent if the file exists (copilot CLI requires it)
    if (agentFileExists) {
      sessionOptions.agent = agentSlug;
    }

    if (options.model) {
      sessionOptions.model = options.model;
    }

    // Execute the session
    let sessionResult: SessionResult;
    try {
      sessionResult = await this.sessionExecutor.executeSession(prompt, sessionOptions);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        agentUsed: agentProfile.name,
        output: `Session execution failed: ${msg}`,
        duration: Date.now() - startTime,
        wasQuickFixEligible: true,
        reason: msg
      };
    }

    // Skip verification if requested
    if (options.skipVerification) {
      return {
        success: sessionResult.success,
        agentUsed: agentProfile.name,
        sessionResult,
        output: sessionResult.output,
        duration: Date.now() - startTime,
        wasQuickFixEligible: true,
        reason: eligibility.reason
      };
    }

    // Verify the work
    let verificationPassed = false;
    if (sessionResult.success && sessionResult.transcriptPath) {
      try {
        const verificationResult = await this.verifier.verifyStep(
          1, // Quick-fix is always "step 1"
          agentProfile.name,
          sessionResult.transcriptPath,
          {
            requireTests: false, // Don't require tests for quick fixes
            requireBuild: false, // Don't require build for quick fixes
            requireCommits: true // Do require commits
          }
        );

        verificationPassed = verificationResult.passed;
      } catch (error: unknown) {
        // Verification error - don't fail hard in quick-fix mode
        logger.warn(`⚠️  Verification skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const duration = Date.now() - startTime;

    return {
      success: sessionResult.success,
      agentUsed: agentProfile.name,
      sessionResult,
      verificationPassed,
      output: sessionResult.output,
      duration,
      wasQuickFixEligible: true,
      reason: eligibility.reason
    };
  }

  /**
   * Build a prompt for quick-fix mode
   */
  private buildQuickFixPrompt(task: string, agent: AgentProfile): string {
    const sections: string[] = [];

    sections.push('=== QUICK-FIX MODE ===\n');
    sections.push('You are executing a simple, focused task that does not require');
    sections.push('full swarm orchestration. Work quickly and efficiently.\n');

    sections.push(`Agent: ${agent.name}`);
    sections.push(`Description: ${agent.description}\n`);

    sections.push('TASK:');
    sections.push(task + '\n');

    sections.push('QUICK-FIX GUIDELINES:');
    sections.push('- Keep changes minimal and focused');
    sections.push('- Make 1-3 small commits with clear messages');
    sections.push('- No need for comprehensive testing unless task requires it');
    sections.push('- Document changes briefly');
    sections.push('- Run quick verification (linting, basic tests if applicable)\n');

    sections.push('Your scope:');
    agent.scope.forEach(item => {
      sections.push('- ' + item);
    });
    sections.push('');

    sections.push('Boundaries (do not exceed):');
    agent.boundaries.forEach(item => {
      sections.push('- ' + item);
    });
    sections.push('');

    sections.push('Done when:');
    agent.done_definition.forEach(item => {
      sections.push('- ' + item);
    });
    sections.push('');

    sections.push('IMPORTANT:');
    sections.push('Make natural, incremental git commits as you work.');
    sections.push('Run /share when complete to save transcript.\n');

    return sections.join('\n');
  }
}

export default QuickFixMode;
