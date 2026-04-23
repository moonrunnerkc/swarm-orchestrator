#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { normalizeLeadingGlobalFlags, parseOutputFormat } from './cli/flags';
import { configureLogger, getLogger } from './logger';

const startupArgs = process.argv.slice(2);
configureLogger({
  level: startupArgs.includes('--verbose') ? 'debug' : 'info',
  outputFormat: parseOutputFormat(startupArgs),
});
const logger = getLogger('cli');

/**
 * Parse a single .env file and set any variables not already in process.env.
 * Supports KEY=value, KEY="value", KEY='value', and `export KEY=value`.
 * Skips blank lines and comments. No external dependencies.
 */
function parseDotenvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf-8');
  logger.debug(`loading env file ${filePath}`);
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const stripped = line.startsWith('export ') ? line.slice(7) : line;
    const eqIndex = stripped.indexOf('=');
    if (eqIndex === -1) continue;

    const key = stripped.slice(0, eqIndex).trim();
    let value = stripped.slice(eqIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Load .env from multiple locations so API keys are found regardless
 * of which target repo the user runs the command from.
 *
 * Search order (first match for a given key wins):
 *   1. cwd (the target project directory)
 *   2. The orchestrator's own install directory (where cli.js lives)
 *   3. The user's home directory (~/.env) as a last-resort fallback
 */
function loadDotenv(): void {
  const candidates: string[] = [
    path.resolve(process.cwd(), '.env'),
  ];

  // __dirname at runtime is dist/src/, so two levels up reaches the
  // project root where .env and package.json live.
  const orchestratorRoot = path.resolve(__dirname, '..', '..');
  const orchestratorEnv = path.join(orchestratorRoot, '.env');
  if (orchestratorEnv !== candidates[0]) {
    candidates.push(orchestratorEnv);
  }

  const homeEnv = path.join(process.env.HOME || process.env.USERPROFILE || '', '.env');
  if (homeEnv && !candidates.includes(homeEnv)) {
    candidates.push(homeEnv);
  }

  for (const envPath of candidates) {
    parseDotenvFile(envPath);
  }
}

loadDotenv();

import {
  generatePlan,
  handleAgentsCommand,
  handleAuditCommand,
  handleBootstrapCommand,
  handleDashboardCommand,
  handleDemoCommand,
  handleExecuteCommand,
  handleGatesCommand,
  handleMetricsCommand,
  handlePlanCommand,
  handleQuickCommand,
  handleRecipeInfoCommand,
  handleRecipesCommand,
  handleReportCommand,
  handleRunCommand,
  handleShareCommand,
  handleStatusCommand,
  handleSwarmCommand,
  handleTemplatesCommand,
  handleUseCommand,
  showUsage,
} from './cli/index';
import { startMcpServer } from './mcp-server';

async function main(): Promise<void> {
  const args = normalizeLeadingGlobalFlags(process.argv.slice(2));

  if (args.length === 0) {
    showUsage();
    return;
  }

  const command = args[0];
  let exitCode = 0;

  try {
    switch (command) {
      case 'demo-fast':
        exitCode = await handleDemoCommand(['demo', 'demo-fast', ...args.slice(1)]);
        break;
      case 'gates':
        exitCode = await handleGatesCommand(args.slice(1));
        break;
      case 'quick':
        exitCode = await handleQuickCommand(args);
        break;
      case 'bootstrap':
        exitCode = await handleBootstrapCommand(args);
        break;
      case 'plan':
        exitCode = await handlePlanCommand(args);
        break;
      case 'execute':
        exitCode = await handleExecuteCommand(args);
        break;
      case 'status':
        exitCode = await handleStatusCommand(args);
        break;
      case 'swarm':
        exitCode = await handleSwarmCommand(args);
        break;
      case 'demo':
        exitCode = await handleDemoCommand(args);
        break;
      case 'dashboard':
        exitCode = await handleDashboardCommand(args);
        break;
      case 'templates':
        exitCode = await handleTemplatesCommand();
        break;
      case '--help':
      case '-h':
        showUsage();
        break;
      case 'share':
        exitCode = await handleShareCommand(args);
        break;
      case 'audit':
        exitCode = await handleAuditCommand(args);
        break;
      case 'metrics':
        exitCode = await handleMetricsCommand(args);
        break;
      case 'run':
        exitCode = await handleRunCommand(args);
        break;
      case 'report':
        exitCode = await handleReportCommand(args);
        break;
      case 'agents':
        exitCode = await handleAgentsCommand(args);
        break;
      case 'use':
        exitCode = await handleUseCommand(args);
        break;
      case 'recipes':
        exitCode = handleRecipesCommand();
        break;
      case 'recipe-info':
        exitCode = handleRecipeInfoCommand(args);
        break;
      case 'mcp-server':
        startMcpServer(process.cwd());
        break;
      default:
        logger.error(`Unknown command: ${command}\n`);
        showUsage();
        exitCode = 1;
    }
  } catch (error) {
    logger.error('Fatal error:', error instanceof Error ? error.message : String(error));
    exitCode = 1;
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

if (require.main === module) {
  main();
}

export { generatePlan, main };
