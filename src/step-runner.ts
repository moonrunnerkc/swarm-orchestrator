import * as fs from 'fs';
import * as path from 'path';
import { ExecutionPlan, PlanStep } from './plan-generator';
import { AgentProfile } from './config-loader';
import { ExecutionOptions } from './types';
import { GitHubMcpIntegrator } from './github-mcp-integrator';
import SessionExecutor, { SessionResult, SessionOptions } from './session-executor';
import { getLogger } from './logger';
const logger = getLogger('step-runner');

export interface StepResult {
  stepNumber: number;
  agentName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startTime?: string;
  endTime?: string;
  outputs?: string[];
  errors?: string[];
  transcriptPath?: string;
}

export interface ExecutionContext {
  plan: ExecutionPlan;
  planFilename: string;
  executionId: string;
  startTime: string;
  endTime?: string;
  currentStep: number;
  stepResults: StepResult[];
  priorContext: string[];  // Accumulated context from previous steps
  options?: ExecutionOptions;  // GitHub integration flags
}

export class StepRunner {
  private proofDir: string;
  private sessionExecutor: SessionExecutor;

  constructor(proofDir?: string) {
    this.proofDir = proofDir || path.join(process.cwd(), 'proof');
    this.sessionExecutor = new SessionExecutor(process.cwd());
  }

  /**
   * Initialize execution context for a plan
   */
  initializeExecution(plan: ExecutionPlan, planFilename: string, options?: ExecutionOptions): ExecutionContext {
    const executionId = this.generateExecutionId();
    
    const context: ExecutionContext = {
      plan,
      planFilename,
      executionId,
      startTime: new Date().toISOString(),
      currentStep: 0,
      stepResults: plan.steps.map(step => ({
        stepNumber: step.stepNumber,
        agentName: step.agentName,
        status: 'pending'
      })),
      priorContext: []
    };

    if (options) {
      context.options = options;
    }

    return context;
  }

  /**
   * Generate the session starter prompt for a Copilot CLI session
   * This is what the user should paste into their Copilot CLI session
   */
  generateSessionPrompt(
    step: PlanStep,
    agent: AgentProfile,
    context: ExecutionContext
  ): string {
    const lines: string[] = [];

    lines.push('='.repeat(70));
    lines.push(`COPILOT CLI SESSION - Step ${step.stepNumber}`);
    lines.push('='.repeat(70));
    lines.push('');

    lines.push('You are operating as a GitHub Copilot CLI custom agent within a supervised,');
    lines.push('sequential workflow.');
    lines.push('');

    lines.push('Context');
    lines.push('-------');
    lines.push(`- This repository is: ${context.plan.goal}`);
    lines.push(`- Execution ID: ${context.executionId}`);
    lines.push(`- Step: ${step.stepNumber} of ${context.plan.steps.length}`);
    lines.push('- Your work must be fully auditable through session transcripts, git history,');
    lines.push('  and test output.');
    lines.push('');

    lines.push('Your assigned role');
    lines.push('------------------');
    lines.push(`- Agent name: ${agent.name}`);
    lines.push(`- Domain scope: ${agent.purpose}`);
    lines.push('- You must stay strictly within this domain.');
    lines.push('- If a task exceeds this scope, say so and stop.');
    lines.push('');

    lines.push('Your specific task for this step');
    lines.push('---------------------------------');
    lines.push(step.task);
    lines.push('');

    lines.push('Scope (what you ARE responsible for)');
    lines.push('-------------------------------------');
    agent.scope.forEach(item => {
      lines.push(`- ${item}`);
    });
    lines.push('');

    lines.push('Boundaries (what you should NOT do)');
    lines.push('-----------------------------------');
    agent.boundaries.forEach(item => {
      lines.push(`- ${item}`);
    });
    lines.push('');

    lines.push('Done definition (when you can say "done")');
    lines.push('------------------------------------------');
    agent.done_definition.forEach(item => {
      lines.push(`- ${item}`);
    });
    lines.push('');

    lines.push('Hard rules');
    lines.push('----------');
    lines.push('1. Do not invent features, flags, APIs, or tool behavior.');
    lines.push('2. If you are uncertain about anything, explicitly say you are uncertain');
    lines.push('   and list how to verify it.');
    lines.push('3. Do not claim tests passed unless you actually ran them and can show');
    lines.push('   the command output.');
    lines.push('4. Do not say "done" unless all required artifacts listed below exist.');
    lines.push('5. Prefer small, reviewable changes over large refactors.');
    lines.push('');

    lines.push('Refusal rules (when to stop and ask)');
    lines.push('-------------------------------------');
    agent.refusal_rules.forEach(rule => {
      lines.push(`- ${rule}`);
    });
    lines.push('');

    if (step.dependencies.length > 0) {
      lines.push('Dependencies (steps you can rely on)');
      lines.push('------------------------------------');
      lines.push(`This step depends on: Steps ${step.dependencies.join(', ')}`);
      lines.push('');
      
      if (context.priorContext.length > 0) {
        lines.push('Context from prior steps:');
        context.priorContext.forEach(ctx => {
          lines.push(`  ${ctx}`);
        });
        lines.push('');
      }
    }

    lines.push('Required artifacts for this step');
    lines.push('--------------------------------');
    lines.push(`You must produce all of the following before ending the session:`);
    lines.push('');
    lines.push('1. Implementation changes (code, config, etc.)');
    lines.push('2. A verification section that includes:');
    lines.push('   - What commands you ran');
    lines.push('   - What tests were executed');
    lines.push('   - The results of those tests');
    lines.push('   - Any gaps or risks that remain');
    lines.push('');
    lines.push('Expected outputs:');
    step.expectedOutputs.forEach(output => {
      lines.push(`   - ${output}`);
    });
    lines.push('');

    // add GitHub integration instructions
    if (context.options?.mcp) {
      lines.push('');
      lines.push(GitHubMcpIntegrator.generateMcpPromptSection());
      lines.push('');
    }

    if (context.options?.delegate) {
      lines.push('');
      lines.push(GitHubMcpIntegrator.generateDelegatePromptSection());
      lines.push('');
    }

    const transcriptPath = agent.output_contract.transcript.replace('{N}', step.stepNumber.toString());
    lines.push(`3. Proof transcript saved to: ${transcriptPath}`);
    lines.push('');

    lines.push('Session closure');
    lines.push('---------------');
    lines.push('- When the step is complete, run /share to capture the session transcript.');
    lines.push('- The /share output is the authoritative record of this step.');
    lines.push('- Save the transcript to the proof file listed above.');
    lines.push('- Do not summarize results outside of the proof transcript.');
    lines.push('');

    lines.push('If any requirement cannot be met, stop and explain why before proceeding.');
    lines.push('');
    lines.push('='.repeat(70));
    lines.push('BEGIN WORK');
    lines.push('='.repeat(70));

    return lines.join('\n');
  }

  /**
   * Execute a step programmatically (automated execution)
   * Returns session result with transcript path
   */
  async executeStepAutomated(
    step: PlanStep,
    agent: AgentProfile,
    context: ExecutionContext,
    options?: {
      model?: string;
      retries?: number;
    }
  ): Promise<SessionResult> {
    logger.info(`\nExecuting Step ${step.stepNumber} (${agent.name}) programmatically...`);
    
    const sessionOptions = {
      model: options?.model || undefined,
      allowAllTools: true,
      silent: false
    } as SessionOptions;

    // execute with retry
    const maxRetries = options?.retries || 3;
    const result = await this.sessionExecutor.executeWithRetry(
      this.sessionExecutor['buildStepPrompt'](step, agent, context),
      sessionOptions,
      maxRetries
    );

    if (result.success && result.transcriptPath) {
      logger.info(`✓ Step ${step.stepNumber} completed`);
      logger.info(`  Transcript: ${result.transcriptPath}`);
    } else {
      logger.error(`✗ Step ${step.stepNumber} failed after ${maxRetries} attempts`);
      if (result.error) {
        logger.error(`  Error: ${result.error}`);
      }
    }

    return result;
  }

  /**
   * Display instructions for executing a step
   */
  displayStepInstructions(
    step: PlanStep,
    agent: AgentProfile,
    context: ExecutionContext
  ): void {
    const prompt = this.generateSessionPrompt(step, agent, context);
    
    logger.info('\n' + '='.repeat(70));
    logger.info(`Step ${step.stepNumber}: ${step.task}`);
    logger.info(`Agent: ${agent.name}`);
    logger.info('='.repeat(70));
    logger.info('');
    logger.info('INSTRUCTIONS:');
    logger.info('-------------');
    logger.info('1. Open a new GitHub Copilot CLI session in this repository');
    logger.info('2. Copy the prompt below and paste it into the session');
    logger.info('3. Work with Copilot to complete the task');
    logger.info('4. When done, run /share and save the transcript');
    logger.info('');
    logger.info('SESSION PROMPT (copy everything below):');
    logger.info('');
    logger.info(prompt);
    logger.info('');
  }

  /**
   * Mark a step as completed and update context
   */
  completeStep(
    context: ExecutionContext,
    stepNumber: number,
    transcriptPath: string,
    outputs: string[]
  ): void {
    const resultIndex = context.stepResults.findIndex(r => r.stepNumber === stepNumber);
    
    if (resultIndex === -1) {
      throw new Error(`Step ${stepNumber} not found in execution context`);
    }

    const result = context.stepResults[resultIndex];
    if (!result) {
      throw new Error(`Step result ${stepNumber} is undefined`);
    }

    result.status = 'completed';
    result.endTime = new Date().toISOString();
    result.transcriptPath = transcriptPath;
    result.outputs = outputs;

    // Add to prior context for next steps
    const contextSummary = `Step ${stepNumber} (${result.agentName}): ${outputs.join(', ')}`;
    context.priorContext.push(contextSummary);

    context.currentStep = stepNumber;
  }

  /**
   * Mark a step as failed
   */
  failStep(
    context: ExecutionContext,
    stepNumber: number,
    errors: string[]
  ): void {
    const resultIndex = context.stepResults.findIndex(r => r.stepNumber === stepNumber);
    
    if (resultIndex === -1) {
      throw new Error(`Step ${stepNumber} not found in execution context`);
    }

    const result = context.stepResults[resultIndex];
    if (!result) {
      throw new Error(`Step result ${stepNumber} is undefined`);
    }

    result.status = 'failed';
    result.endTime = new Date().toISOString();
    result.errors = errors;

    context.currentStep = stepNumber;
  }

  /**
   * Save execution context to file
   */
  saveExecutionContext(context: ExecutionContext): string {
    this.ensureProofDirectory();
    
    const filename = `execution-${context.executionId}.json`;
    const filepath = path.join(this.proofDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(context, null, 2), 'utf8');
    
    return filepath;
  }

  /**
   * Load execution context from file
   */
  loadExecutionContext(executionId: string): ExecutionContext {
    const filename = `execution-${executionId}.json`;
    const filepath = path.join(this.proofDir, filename);
    
    if (!fs.existsSync(filepath)) {
      throw new Error(`Execution context not found: ${filepath}`);
    }

    const content = fs.readFileSync(filepath, 'utf8');
    return JSON.parse(content) as ExecutionContext;
  }

  private generateExecutionId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `exec-${timestamp}`;
  }

  private ensureProofDirectory(): void {
    if (!fs.existsSync(this.proofDir)) {
      fs.mkdirSync(this.proofDir, { recursive: true });
    }
  }

  /**
   * Generate execution summary
   */
  generateSummary(context: ExecutionContext): string {
    const lines: string[] = [];

    lines.push('='.repeat(70));
    lines.push('EXECUTION SUMMARY');
    lines.push('='.repeat(70));
    lines.push('');
    lines.push(`Goal: ${context.plan.goal}`);
    lines.push(`Execution ID: ${context.executionId}`);
    lines.push(`Started: ${context.startTime}`);
    if (context.endTime) {
      lines.push(`Ended: ${context.endTime}`);
    }
    lines.push('');

    lines.push('Step Results:');
    lines.push('-------------');
    context.stepResults.forEach(result => {
      const step = context.plan.steps.find(s => s.stepNumber === result.stepNumber);
      const statusIcon = result.status === 'completed' ? '✓' : 
                        result.status === 'failed' ? '✗' :
                        result.status === 'running' ? '⋯' : '○';
      
      lines.push(`${statusIcon} Step ${result.stepNumber}: ${step?.task || 'Unknown'}`);
      lines.push(`  Agent: ${result.agentName}`);
      lines.push(`  Status: ${result.status}`);
      
      if (result.transcriptPath) {
        lines.push(`  Transcript: ${result.transcriptPath}`);
      }
      
      if (result.outputs && result.outputs.length > 0) {
        lines.push(`  Outputs: ${result.outputs.join(', ')}`);
      }
      
      if (result.errors && result.errors.length > 0) {
        lines.push(`  Errors: ${result.errors.join(', ')}`);
      }
      
      lines.push('');
    });

    return lines.join('\n');
  }
}

export default StepRunner;
