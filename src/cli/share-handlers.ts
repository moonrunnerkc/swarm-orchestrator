/**
 * Share-related CLI command handlers extracted from cli-handlers.ts.
 * Handles /share transcript import and prior-context display.
 */

import { SessionManager } from '../session-manager';
import { showUsage } from './usage';
import { getLogger } from '../logger';

const logger = getLogger('cli:share');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function importShare(runId: string, stepNumber: string, agentName: string, transcriptPath: string): number {
  logger.info('Swarm Orchestrator - Import /share Transcript\n');

  const step = parseInt(stepNumber, 10);
  if (isNaN(step)) {
    logger.error('Error: Step number must be a number');
    return 1;
  }

  const manager = new SessionManager();

  try {
    const stepShare = manager.importShare(runId, step, agentName, transcriptPath);

    logger.info(`✓ Imported /share transcript for step ${step}`);
    logger.info(`  Agent: ${agentName}`);
    logger.info(`  Run: ${runId}`);
    logger.info(`  Saved to: ${stepShare.transcriptPath}\n`);

    logger.info('Extracted Index:');
    logger.info('===============');

    if (stepShare.index.changedFiles.length > 0) {
      logger.info(`\nChanged Files (${stepShare.index.changedFiles.length}):`);
      stepShare.index.changedFiles.forEach(file => logger.info(`  - ${file}`));
    }

    if (stepShare.index.commandsExecuted.length > 0) {
      logger.info(`\nCommands Executed (${stepShare.index.commandsExecuted.length}):`);
      stepShare.index.commandsExecuted.forEach(cmd => logger.info(`  $ ${cmd}`));
    }

    if (stepShare.index.testsRun.length > 0) {
      logger.info(`\nTests Run:`);
      stepShare.index.testsRun.forEach(test => {
        const status = test.verified ? '✓' : '✗';
        logger.info(`  ${status} ${test.command}`);
        if (!test.verified && test.reason) {
          logger.info(`    reason: ${test.reason}`);
        }
      });
    }

    if (stepShare.index.prLinks.length > 0) {
      logger.info(`\nPR Links:`);
      stepShare.index.prLinks.forEach(link => logger.info(`  - ${link}`));
    }

    if (stepShare.index.claims.length > 0) {
      logger.info(`\nClaims Verification:`);
      stepShare.index.claims.forEach(claim => {
        const status = claim.verified ? '✓' : '⚠';
        logger.info(`  ${status} ${claim.claim.substring(0, 80)}`);
        if (claim.evidence) {
          logger.info(`    evidence: ${claim.evidence}`);
        }
      });
    }

    const unverified = stepShare.index.claims.filter(c => !c.verified);
    if (unverified.length > 0) {
      logger.warn(`\n⚠ WARNING: ${unverified.length} unverified claims detected`);
      logger.warn('this step may require manual review before proceeding\n');
    } else {
      logger.info('\n✓ All claims verified\n');
    }

    return 0;
  } catch (error) {
    logger.error('Error importing share:', error instanceof Error ? error.message : error);
    return 1;
  }
}

function showShareContext(runId: string, stepNumber: string): number {
  logger.info('Swarm Orchestrator - Prior Context\n');

  const step = parseInt(stepNumber, 10);
  if (isNaN(step)) {
    logger.error('Error: Step number must be a number');
    return 1;
  }

  const manager = new SessionManager();

  try {
    const summary = manager.generateContextSummary(runId, step);
    logger.info(`Prior context for step ${step} in run ${runId}:\n`);
    logger.info(summary);
    logger.info('');

    const allUnverified = manager.getUnverifiedClaims(runId);
    if (allUnverified.length > 0) {
      logger.warn('⚠ UNVERIFIED CLAIMS IN PRIOR STEPS:');
      allUnverified.forEach(item => {
        logger.warn(`  Step ${item.step} (${item.agent}): ${item.claims.length} unverified claims`);
      });
      logger.info('');
    }

    return 0;
  } catch (error) {
    logger.error('Error loading context:', error instanceof Error ? error.message : error);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Exported command handler
// ---------------------------------------------------------------------------

export async function handleShareCommand(args: string[]): Promise<number> {
  const subcommand = args[1];

  if (!subcommand) {
    logger.error('Error: share subcommand required (import or context)\n');
    showUsage();
    return 1;
  }

  if (subcommand === 'import') {
    if (args.length < 6) {
      logger.error('Error: share import requires: <runid> <step> <agent> <path>\n');
      showUsage();
      return 1;
    }
    const runId = args[2];
    const stepNumber = args[3];
    const agentName = args[4];
    const transcriptPath = args[5];
    if (!runId || !stepNumber || !agentName || !transcriptPath) {
      logger.error('Error: all arguments required\n');
      showUsage();
      return 1;
    }
    try {
      return importShare(runId, stepNumber, agentName, transcriptPath);
    } catch (error) {
      logger.error('Error:', error instanceof Error ? error.message : error);
      return 1;
    }
  }

  if (subcommand === 'context') {
    if (args.length < 4) {
      logger.error('Error: share context requires: <runid> <step>\n');
      showUsage();
      return 1;
    }
    const runId = args[2];
    const stepNumber = args[3];
    if (!runId || !stepNumber) {
      logger.error('Error: all arguments required\n');
      showUsage();
      return 1;
    }
    try {
      return showShareContext(runId, stepNumber);
    } catch (error) {
      logger.error('Error:', error instanceof Error ? error.message : error);
      return 1;
    }
  }

  logger.error(`Unknown share subcommand: ${subcommand}\n`);
  showUsage();
  return 1;
}
