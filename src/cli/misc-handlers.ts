/**
 * Miscellaneous CLI command handlers extracted from cli-handlers.ts.
 * Covers recipes, recipe-info, agents export, and the `use` command.
 */

import * as path from 'path';
import { PlanStorage } from '../plan-storage';
import { loadRecipe, listRecipeDetails, parameterizeRecipe } from '../recipe-loader';
import AgentsExporter from '../agents-exporter';
import { parseSwarmFlags } from './flags';
import { getLogger } from '../logger';

const logger = getLogger('cli:misc');

import { executeSwarm } from './swarm-handlers';

// ---------------------------------------------------------------------------
// recipe command handlers
// ---------------------------------------------------------------------------

export async function handleUseCommand(args: string[]): Promise<number> {
  const recipeName = args[1];
  if (!recipeName) {
    logger.error('Error: recipe name required\nUsage: swarm use <recipe> [--param key=value ...]');
    return 1;
  }

  let recipe;
  try {
    recipe = loadRecipe(recipeName);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  // Parse --param key=value pairs from remaining args
  const userParams: Record<string, string> = {};
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--param' && args[i + 1]) {
      const eq = args[i + 1].indexOf('=');
      if (eq === -1) {
        logger.error(`Invalid parameter format: "${args[i + 1]}". Expected key=value`);
        return 1;
      }
      const key = args[i + 1].substring(0, eq);
      const value = args[i + 1].substring(eq + 1);
      userParams[key] = value;
      i++; // skip the value token
    }
  }

  let plan;
  try {
    plan = parameterizeRecipe(recipe, userParams);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  logger.info(`🐝 Recipe: ${recipe.name}\n`);
  logger.info(`   ${recipe.description}`);
  logger.info(`   Category: ${recipe.category}`);
  logger.info(`   Steps: ${plan.steps.length}\n`);

  plan.steps.forEach(step => {
    logger.info(`   Step ${step.stepNumber}: ${step.task.substring(0, 80)}${step.task.length > 80 ? '...' : ''}`);
  });
  logger.info('');

  // Save the parameterized plan, then delegate to executeSwarm
  const storage = new PlanStorage();
  const planPath = storage.savePlan(plan, `recipe-${recipeName}-${Date.now()}.json`);
  logger.info(`Plan saved: ${planPath}\n`);

  try {
    const options = parseSwarmFlags(args);
    const exitCode = await executeSwarm(path.basename(planPath), options);

    // Record recipe run in knowledge base after execution
    try {
      const { KnowledgeBaseManager } = await import('../knowledge-base');
      const kb = new KnowledgeBaseManager();
      kb.recordRecipeRun({
        recipe: recipeName,
        parameters: userParams,
        tool: options.cliAgent || 'copilot',
        passed: exitCode === 0,
        duration: 0,
        stepsCompleted: plan.steps.length,
        totalSteps: plan.steps.length,
      });
    } catch {
      // Knowledge base recording is non-critical
    }

    return exitCode;
  } catch (error) {
    logger.error('Error executing recipe:', error instanceof Error ? error.message : error);
    return 1;
  }
}

export function handleRecipesCommand(): number {
  const recipes = listRecipeDetails();

  if (recipes.length === 0) {
    logger.info('No recipes found.');
    return 0;
  }

  logger.info('\n╔══════════════════════════════════════════════════════════════════════╗');
  logger.info('║  Available Recipes                                                   ║');
  logger.info('╚══════════════════════════════════════════════════════════════════════╝\n');

  for (const recipe of recipes) {
    logger.info(`  ${recipe.name}`);
    logger.info(`    ${recipe.description}`);
    logger.info(`    Category: ${recipe.category} | Steps: ${recipe.steps.length}`);
    const paramNames = Object.keys(recipe.parameters);
    if (paramNames.length > 0) {
      logger.info(`    Parameters: ${paramNames.join(', ')}`);
    }
    logger.info('');
  }

  logger.info('Usage: swarm use <recipe> [--param key=value ...]\n');
  return 0;
}

export function handleRecipeInfoCommand(args: string[]): number {
  const recipeName = args[1];
  if (!recipeName) {
    logger.error('Error: recipe name required\nUsage: swarm recipe-info <name>');
    return 1;
  }

  let recipe;
  try {
    recipe = loadRecipe(recipeName);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  logger.info(`\nRecipe: ${recipe.name}`);
  logger.info(`Description: ${recipe.description}`);
  logger.info(`Category: ${recipe.category}\n`);

  logger.info('Parameters:');
  for (const [key, param] of Object.entries(recipe.parameters)) {
    const defaultStr = param.default !== undefined ? ` (default: ${param.default})` : ' (required)';
    const optionsStr = param.options ? ` [${param.options.join(' | ')}]` : '';
    logger.info(`  --param ${key}=<value>  ${param.description}${defaultStr}${optionsStr}`);
  }
  logger.info('');

  logger.info('Steps:');
  for (const step of recipe.steps) {
    const deps = step.dependencies.length > 0 ? ` (after step ${step.dependencies.join(', ')})` : '';
    logger.info(`  ${step.stepNumber}. [${step.agentName}] ${step.task.substring(0, 70)}${step.task.length > 70 ? '...' : ''}${deps}`);
  }
  logger.info('');

  return 0;
}

// ---------------------------------------------------------------------------
// agents command handler
// ---------------------------------------------------------------------------

export async function handleAgentsCommand(args: string[]): Promise<number> {
  const subcommand = args[1];

  if (subcommand !== 'export') {
    logger.error('Usage: swarm agents export [--output-dir dir] [--min-runs N] [--diff]');
    return 1;
  }

  // Parse flags
  const outputDirIdx = args.indexOf('--output-dir');
  const outputDir = outputDirIdx !== -1 && args[outputDirIdx + 1]
    ? args[outputDirIdx + 1]
    : path.join(process.cwd(), 'agents');

  const minRunsIdx = args.indexOf('--min-runs');
  let minRuns = 5;
  if (minRunsIdx !== -1 && args[minRunsIdx + 1]) {
    const parsed = parseInt(args[minRunsIdx + 1], 10);
    if (!isNaN(parsed) && parsed > 0) minRuns = parsed;
  }

  const diff = args.includes('--diff');

  logger.info('🐝 Swarm Orchestrator - Agent Export\n');
  logger.info(`Output directory: ${outputDir}`);
  logger.info(`Minimum runs for data-driven export: ${minRuns}`);
  if (diff) logger.info('Diff mode: enabled\n');
  else logger.info('');

  const exporter = new AgentsExporter();
  const result = exporter.export({ outputDir, minRuns, diff });

  if (result.fromData) {
    logger.info(`Exported ${result.agentsExported.length} agent(s) with data-driven recommendations.`);
  } else {
    logger.info(`Exported ${result.agentsExported.length} agent(s) from base definitions (insufficient run data).`);
  }

  for (const name of result.agentsExported) {
    const filename = name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.agent.md';
    logger.info(`  - ${filename}`);
  }

  if (diff && result.diffs.length > 0) {
    logger.info(`\nChanges detected (${result.diffs.length} diff(s)):`);
    for (const d of result.diffs) {
      logger.info(`  ${d.agentName} / ${d.field}:`);
      if (d.previous) logger.info(`    - ${d.previous.slice(0, 100)}`);
      logger.info(`    + ${d.current.slice(0, 100)}`);
    }
  } else if (diff) {
    logger.info('\nNo changes detected since last export.');
  }

  logger.info(`\nAgent files written to: ${outputDir}`);
  return 0;
}
