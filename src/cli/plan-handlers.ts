/**
 * Plan-related CLI command handlers extracted from cli-handlers.ts.
 * Each handler validates its arguments, performs the work, and returns an
 * exit code (0 = success, 1 = failure). No handler calls process.exit.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConfigLoader } from '../config-loader';
import { PlanGenerator } from '../plan-generator';
import { PlanStorage } from '../plan-storage';
import { StepRunner } from '../step-runner';
import { ExecutionOptions } from '../types';
import { defaultModelForAdapter } from '../adapters';
import {
  extractPositionalArgs,
  normalizeLeadingGlobalFlags,
  parseOutputFormat,
} from './flags';
import { showUsage } from './usage';
import { getLogger, writeStructuredOutput } from '../logger';

const logger = getLogger('cli:plan');

// ---------------------------------------------------------------------------
// Plan helpers (exported from this module; called by the handle* functions)
// ---------------------------------------------------------------------------

export function generatePlan(goal: string, copilotMode: boolean = false, opts?: { planCache?: boolean }): void {
  const configLoader = new ConfigLoader();
  const agents = configLoader.loadAllAgents();
  const generator = new PlanGenerator(agents);

  if (copilotMode) {
    logger.info('╔══════════════════════════════════════════════════════════════════════╗');
    logger.info('║  COPILOT CLI PLANNING MODE                                           ║');
    logger.info('╚══════════════════════════════════════════════════════════════════════╝\n');
    logger.info('📋 Goal:', goal, '\n');
    logger.info('Instructions:');
    logger.info('  1. Copy the prompt below');
    logger.info('  2. Start a new Copilot CLI session: copilot');
    logger.info('  3. Paste the prompt and press Enter');
    logger.info('  4. When Copilot responds with JSON, run: /share');
    logger.info('  5. Save the /share transcript to a file');
    logger.info('  6. Import the plan: swarm plan import <runid> <transcript-path>\n');
    logger.info('═'.repeat(70));
    logger.info('PROMPT (copy from next line until the marker):');
    logger.info('═'.repeat(70));
    logger.info();

    const prompt = generator.generateCopilotPlanningPrompt(goal);
    logger.info(prompt);

    logger.info();
    logger.info('═'.repeat(70));
    logger.info('END OF PROMPT');
    logger.info('═'.repeat(70));
    logger.info();
    return;
  }

  logger.info('╔══════════════════════════════════════════════════════════════════════╗');
  logger.info('║  INTELLIGENT PLAN GENERATION (Fallback Mode)                        ║');
  logger.info('╚══════════════════════════════════════════════════════════════════════╝\n');
  logger.info('📋 Goal:', goal, '\n');
  logger.info('💡 Tip: Use --copilot for Copilot CLI-generated plans\n');

  logger.info(`Loaded ${agents.length} agent profiles:`);
  agents.forEach(agent => {
    logger.info(`  ✓ ${agent.name}: ${agent.purpose}`);
  });
  logger.info();

  const plan = generator.createPlan(goal, undefined, opts?.planCache ? { planCache: true } : undefined);

  logger.info('Generated Execution Plan:');
  logger.info('═'.repeat(70));
  logger.info();

  plan.steps.forEach(step => {
    logger.info(`Step ${step.stepNumber}: ${step.task}`);
    logger.info(`  👤 Agent: ${step.agentName}`);
    if (step.dependencies.length > 0) {
      logger.info(`  🔗 Dependencies: Steps ${step.dependencies.join(', ')}`);
    }
    logger.info(`  📦 Expected outputs:`);
    step.expectedOutputs.forEach(output => {
      logger.info(`     • ${output}`);
    });
    logger.info();
  });

  const executionOrder = generator.getExecutionOrder(plan);
  logger.info(`🔄 Execution Order: ${executionOrder.join(' → ')}\n`);

  const storage = new PlanStorage();
  const planPath = storage.savePlan(plan);
  logger.info(`✅ Plan saved to: ${planPath}`);
  logger.info(`\n▶  To execute: swarm swarm ${path.basename(planPath)}\n`);
}

export function importPlanFromTranscript(runId: string, transcriptPath: string): number {
  logger.info('╔══════════════════════════════════════════════════════════════════════╗');
  logger.info('║  IMPORT COPILOT-GENERATED PLAN                                       ║');
  logger.info('╚══════════════════════════════════════════════════════════════════════╝\n');

  logger.info('📁 Transcript:', transcriptPath);
  logger.info('🆔 Run ID:', runId);
  logger.info();

  try {
    if (!fs.existsSync(transcriptPath)) {
      throw new Error(`Transcript file not found: ${transcriptPath}`);
    }

    const transcriptContent = fs.readFileSync(transcriptPath, 'utf-8');

    const configLoader = new ConfigLoader();
    const agents = configLoader.loadAllAgents();
    const generator = new PlanGenerator(agents);

    logger.info('🔍 Parsing transcript for JSON plan...');
    const plan = generator.parseCopilotPlanFromTranscript(transcriptContent);

    logger.info('✅ Plan parsed successfully!\n');
    logger.info('Plan details:');
    logger.info(`  Goal: ${plan.goal}`);
    logger.info(`  Steps: ${plan.steps.length}`);
    logger.info(`  Created: ${plan.createdAt}\n`);

    logger.info('Steps:');
    logger.info('═'.repeat(70));
    plan.steps.forEach(step => {
      logger.info(`\nStep ${step.stepNumber}: ${step.task}`);
      logger.info(`  👤 Agent: ${step.agentName}`);
      if (step.dependencies.length > 0) {
        logger.info(`  🔗 Dependencies: ${step.dependencies.join(', ')}`);
      }
      logger.info(`  📦 Outputs: ${step.expectedOutputs.join(', ')}`);
    });
    logger.info('\n' + '═'.repeat(70));

    const executionOrder = generator.getExecutionOrder(plan);
    logger.info(`\n🔄 Execution Order: ${executionOrder.join(' → ')}`);

    const storage = new PlanStorage();
    const planPath = storage.savePlan(plan);
    logger.info(`\n✅ Plan saved to: ${planPath}`);
    logger.info(`\n▶  To execute: swarm swarm ${path.basename(planPath)}\n`);

    return 0;
  } catch (error) {
    logger.error('\n❌ Error importing plan:');
    logger.error('  ', error instanceof Error ? error.message : String(error));
    logger.error('\nTroubleshooting:');
    logger.error('  • Ensure the transcript contains valid JSON output from Copilot');
    logger.error('  • The JSON must match the ExecutionPlan schema');
    logger.error('  • Check that all agent names are valid');
    logger.error('  • Ensure dependencies form a valid DAG (no cycles)\n');
    return 1;
  }
}

export function executePlan(planFilename: string, options?: ExecutionOptions): number {
  logger.info('Swarm Orchestrator - Plan Execution\n');

  const storage = new PlanStorage();
  const plan = storage.loadPlan(planFilename);

  logger.info(`Plan: ${plan.goal}`);
  logger.info(`Steps: ${plan.steps.length}`);

  const { CostEstimator } = require('../cost-estimator') as typeof import('../cost-estimator');
  const seqModel = defaultModelForAdapter(options?.cliAgent);
  const seqEstimator = new CostEstimator();
  const seqEstimate = seqEstimator.estimate(plan, { modelName: seqModel });
  logger.info(`\n💰 Cost Estimate: ${seqEstimate.lowEstimate}-${seqEstimate.totalPremiumRequests} premium requests`);
  logger.info(`   ${plan.steps.length} steps | ${seqModel} (${seqEstimate.modelMultiplier}x)`);

  if (options?.delegate || options?.mcp) {
    logger.info('\nGitHub Integration:');
    if (options.delegate) logger.info('  ✓ /delegate enabled - agents will be instructed to create PRs');
    if (options.mcp) logger.info('  ✓ MCP required - agents must provide GitHub context evidence');
  }
  logger.info('');

  const configLoader = new ConfigLoader();
  const agents = configLoader.loadAllAgents();

  const runner = new StepRunner();
  const context = runner.initializeExecution(plan, planFilename, options);

  logger.info(`Execution ID: ${context.executionId}\n`);

  const generator = new PlanGenerator(agents);
  const executionOrder = generator.getExecutionOrder(plan);

  logger.info(`Execution Order: ${executionOrder.join(' → ')}\n`);
  logger.info('='.repeat(70));
  logger.info('SEQUENTIAL EXECUTION GUIDE');
  logger.info('='.repeat(70));
  logger.info('');
  logger.info('This tool will guide you through each step of the plan.');
  logger.info('For each step, you will:');
  logger.info('  1. Receive a session prompt to copy/paste into Copilot CLI');
  logger.info('  2. Complete the work in that Copilot session');
  logger.info('  3. Run /share to capture the transcript');
  logger.info('  4. Save the transcript to the specified proof file');
  logger.info('  5. Return here to mark the step complete and get the next step');
  logger.info('');
  logger.info('Press ENTER to begin with Step 1...');
  logger.info('');

  const firstStepNumber = executionOrder[0];
  if (firstStepNumber === undefined) {
    logger.error('No steps to execute');
    return 1;
  }

  const firstStep = plan.steps.find(s => s.stepNumber === firstStepNumber);
  if (!firstStep) {
    logger.error(`Step ${firstStepNumber} not found in plan`);
    return 1;
  }

  const agent = agents.find(a => a.name === firstStep.agentName);
  if (!agent) {
    logger.error(`Agent ${firstStep.agentName} not found`);
    return 1;
  }

  runner.displayStepInstructions(firstStep, agent, context);

  const contextPath = runner.saveExecutionContext(context);
  logger.info(`\n✓ Execution context saved to: ${contextPath}`);
  logger.info(`\nTo continue execution after completing this step, run:`);
  logger.info(`  swarm status ${context.executionId}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// Exported command handlers
// ---------------------------------------------------------------------------

export async function handlePlanCommand(args: string[]): Promise<number> {
  const normalizedArgs = normalizeLeadingGlobalFlags(args);
  const outputFormat = parseOutputFormat(normalizedArgs);
  const positional = extractPositionalArgs(normalizedArgs.slice(1), {
    booleanFlags: ['--help', '-h', '--verbose', '--json', '--plan-cache', '--copilot'],
    valueFlags: ['--output'],
  });

  if (normalizedArgs.includes('--help') || normalizedArgs.includes('-h') || positional.length === 0) {
    showUsage();
    return 0;
  }

  const subcommand = positional[0];

  if (subcommand === 'import') {
    if (positional.length < 3) {
      logger.error('Error: plan import requires: <runid> <transcript-path>\n');
      showUsage();
      return 1;
    }
    const runId = positional[1];
    const transcriptPath = positional[2];
    if (!runId || !transcriptPath) {
      logger.error('Error: all arguments required\n');
      showUsage();
      return 1;
    }
    if (outputFormat === 'json') {
      try {
        if (!fs.existsSync(transcriptPath)) {
          throw new Error(`Transcript file not found: ${transcriptPath}`);
        }
        const transcriptContent = fs.readFileSync(transcriptPath, 'utf-8');
        const configLoader = new ConfigLoader();
        const agents = configLoader.loadAllAgents();
        const generator = new PlanGenerator(agents);
        const plan = generator.parseCopilotPlanFromTranscript(transcriptContent);
        const storage = new PlanStorage();
        const planPath = storage.savePlan(plan);
        writeStructuredOutput({ runId, transcriptPath, planFile: planPath, plan });
        return 0;
      } catch (error) {
        logger.error('Error importing plan:', error instanceof Error ? error.message : error);
        return 1;
      }
    }
    return importPlanFromTranscript(runId, transcriptPath);
  }

  if (normalizedArgs.includes('--copilot')) {
    const goal = positional.join(' ');
    if (!goal) {
      logger.error('Error: goal required for --copilot mode\n');
      showUsage();
      return 1;
    }
    try {
      if (outputFormat === 'json') {
        const configLoader = new ConfigLoader();
        const agents = configLoader.loadAllAgents();
        const generator = new PlanGenerator(agents);
        writeStructuredOutput({
          goal,
          mode: 'copilot',
          prompt: generator.generateCopilotPlanningPrompt(goal),
        });
        return 0;
      }
      generatePlan(goal, true);
      return 0;
    } catch (error) {
      logger.error('Error generating Copilot prompt:', error instanceof Error ? error.message : error);
      return 1;
    }
  }

  // plan <goal> (regular mode)
  const usePlanCache = normalizedArgs.includes('--plan-cache');
  const goal = positional.join(' ');
  try {
    if (outputFormat === 'json') {
      const configLoader = new ConfigLoader();
      const agents = configLoader.loadAllAgents();
      const generator = new PlanGenerator(agents);
      const plan = generator.createPlan(goal, undefined, usePlanCache ? { planCache: true } : undefined);
      const storage = new PlanStorage();
      const planPath = storage.savePlan(plan);
      writeStructuredOutput({ goal: plan.goal, planFile: planPath, plan });
      return 0;
    }
    generatePlan(goal, false, { planCache: usePlanCache });
    return 0;
  } catch (error) {
    logger.error('Error generating plan:', error instanceof Error ? error.message : error);
    return 1;
  }
}

export async function handleExecuteCommand(args: string[]): Promise<number> {
  if (args.length < 2 || !args[1]) {
    logger.error('Error: Plan filename required\n');
    showUsage();
    return 1;
  }

  const planFilename = args[1];
  const options: ExecutionOptions = {};
  if (args.includes('--delegate')) options.delegate = true;
  if (args.includes('--mcp')) options.mcp = true;

  try {
    return executePlan(planFilename, Object.keys(options).length > 0 ? options : undefined);
  } catch (error) {
    logger.error('Error executing plan:', error instanceof Error ? error.message : error);
    return 1;
  }
}
