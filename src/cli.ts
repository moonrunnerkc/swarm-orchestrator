#!/usr/bin/env node

import { normalizeLeadingGlobalFlags, parseOutputFormat } from './cli/flags';
import { configureLogger, getLogger, setPrettyMode } from './logger';
import { configurePresenter } from './presenter';

const startupArgs = process.argv.slice(2);

// User-facing commands enable a clean presenter surface by default:
// pretty-mode hides `[scope]` prefixes, diagnostic logger output is routed to
// stderr, and --quiet suppresses everything except errors and the result line.
// `--verbose` keeps the legacy diagnostic-on-stdout shape for developers.
const USER_FACING_COMMANDS = new Set(['run', 'swarm', 'quick', 'demo', 'demo-fast', 'bootstrap']);
const firstNonFlag = startupArgs.find((a) => !a.startsWith('-'));
const isUserFacingCommand = firstNonFlag ? USER_FACING_COMMANDS.has(firstNonFlag) : false;
const isVerbose = startupArgs.includes('--verbose');
const isQuiet = startupArgs.includes('--quiet') || startupArgs.includes('-q');

configureLogger({
  level: isQuiet ? 'warn' : (isVerbose ? 'debug' : 'info'),
  outputFormat: parseOutputFormat(startupArgs),
  // Diagnostic output (info/debug/trace) routes to stderr when the presenter
  // owns stdout. Without pretty mode (developer / non-user-facing commands),
  // diagnostics keep flowing to stdout so tooling that scrapes stdout works.
  diagnosticsToStderr: isUserFacingCommand && !isVerbose,
});

if (isUserFacingCommand && !isVerbose) {
  setPrettyMode(true);
}

configurePresenter({ quiet: isQuiet });

const logger = getLogger('cli');

import { loadDotenv } from './env-loader';

loadDotenv();

import {
  generatePlan,
  handleAgentsCommand,
  handleAttestCommand,
  handleAuditCommand,
  handleBootstrapCommand,
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
import { initActiveRules, readRuleLoaderConfig } from './rules/loader';
import { handleV8Command } from './cli/v8/index';
import { handleRunV8 } from './cli/v8/run-wrapper';

/**
 * Commands that consume cheat rules or other rule-pack data and benefit from
 * a startup summary of what loaded. Read-only commands (--help, version,
 * status, audit, metrics, report, agents, attest, use, recipes, recipe-info,
 * share, plan, templates) skip the loader to keep their cold path fast.
 */
const RULE_LOADING_COMMANDS = new Set([
  'demo-fast',
  'gates',
  'quick',
  'bootstrap',
  'execute',
  'swarm',
  'demo',
  'run',
]);

/**
 * Initialize the process-wide active rule set and log a one-line summary so
 * the operator sees which packs and rule counts the orchestrator is about
 * to use. Errors from the loader (configured-but-missing pack, schema
 * failures) are surfaced individually but do not crash the CLI; the run
 * proceeds with whatever loaded successfully.
 */
function loadAndAnnounceRules(projectRoot: string): void {
  const options = readRuleLoaderConfig(projectRoot);
  const result = initActiveRules(options);
  const packIds = result.packs.map((p) => `${p.author}/${p.name}`).join(', ') || '(none)';
  logger.info(`Loaded ${result.rules.length} rules from ${result.packs.length} packs: ${packIds}`);
  for (const err of result.errors) {
    const prefix = err.packId ? `pack ${err.packId}` : 'rule file';
    logger.error(`${prefix}: ${err.message}`);
  }
}

async function main(): Promise<void> {
  const args = normalizeLeadingGlobalFlags(process.argv.slice(2));

  if (args.length === 0) {
    showUsage();
    return;
  }

  const command = args[0];
  let exitCode = 0;

  if (command !== undefined && RULE_LOADING_COMMANDS.has(command)) {
    loadAndAnnounceRules(process.cwd());
  }

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
      case 'run': {
        // Per impl guide §12 line 275: "After Phase 4, v8 becomes
        // opt-out: default switches to v8, --v6 flag preserves old
        // behavior." The dispatch here implements that flip. --v6 is
        // stripped before forwarding.
        const v6Index = args.indexOf('--v6');
        if (v6Index >= 0) {
          const v6Args = args.slice();
          v6Args.splice(v6Index, 1);
          exitCode = await handleRunCommand(v6Args);
        } else {
          exitCode = await handleRunV8(args.slice(1));
        }
        break;
      }
      case 'report':
        exitCode = await handleReportCommand(args);
        break;
      case 'agents':
        exitCode = await handleAgentsCommand(args);
        break;
      case 'attest':
        exitCode = await handleAttestCommand(args);
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
      case 'v8':
        exitCode = await handleV8Command(args.slice(1));
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
