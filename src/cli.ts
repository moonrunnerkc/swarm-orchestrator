#!/usr/bin/env node

import { normalizeLeadingGlobalFlags, parseOutputFormat } from './cli/flags';
import { configureLogger, getLogger, setPrettyMode } from './logger';

const startupArgs = process.argv.slice(2);

const USER_FACING_COMMANDS = new Set(['run']);
const firstNonFlag = startupArgs.find((a) => !a.startsWith('-'));
const isUserFacingCommand = firstNonFlag ? USER_FACING_COMMANDS.has(firstNonFlag) : false;
const isVerbose = startupArgs.includes('--verbose');
const isQuiet = startupArgs.includes('--quiet') || startupArgs.includes('-q');

configureLogger({
  level: isQuiet ? 'warn' : (isVerbose ? 'debug' : 'info'),
  outputFormat: parseOutputFormat(startupArgs),
  diagnosticsToStderr: isUserFacingCommand && !isVerbose,
});

if (isUserFacingCommand && !isVerbose) {
  setPrettyMode(true);
}

const logger = getLogger('cli');

import { loadDotenv } from './env-loader';

loadDotenv();

import { handleV8Command } from './cli/v8/index';
import { handleRunV8 } from './cli/v8/run-wrapper';
import { handleRun as handleV8RunDirect } from './cli/v8/run-handler';

function showUsage(): void {
  process.stdout.write(`
Swarm Orchestrator - Falsification-gated Orchestration for AI Coding Agents

Usage:
  swarm compile <goal>          Compile a goal into a typed contract
  swarm run <contract>          Run a compiled contract through the v8 pipeline
  swarm run --goal "<text>"     Compile + run in one step
  swarm resume <run-id>         Resume a killed run from the ledger
  swarm stats <run-id>          Aggregate diagnostic counts from a run ledger
  swarm doctor                  Probe local prerequisites (API key, falsifiers, PMs)
  swarm --help                  Show this help message

For per-subcommand flags, see \`swarm <command> --help\`.
`);
}

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
      case '--help':
      case '-h':
        showUsage();
        break;
      case 'run': {
        // `run --goal "<text>"` goes through the compile-then-run wrapper;
        // a positional contract path goes straight to the run handler.
        if (args.includes('--goal')) {
          exitCode = await handleRunV8(args.slice(1));
        } else {
          exitCode = await handleV8RunDirect(args.slice(1));
        }
        break;
      }
      case 'compile':
      case 'resume':
      case 'stats':
      case 'doctor':
        // Top-level aliases for the v8 pipeline. `swarm <cmd>` is the
        // documented form; `swarm v8 <cmd>` remains supported for users
        // pinned to the explicit prefix.
        exitCode = await handleV8Command(args);
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

export { main };
