/**
 * CLI command handlers – barrel re-export module.
 *
 * The actual handler implementations live in focused sub-modules under src/cli/.
 * This file re-exports every public symbol so that existing consumers
 * (cli.ts, tests, etc.) continue to work unchanged.
 */

// ── Plan handlers ──────────────────────────────────────────────────────────
export {
  generatePlan,
  importPlanFromTranscript,
  executePlan,
  handlePlanCommand,
  handleExecuteCommand,
} from './plan-handlers';

// ── Swarm / execution handlers ────────────────────────────────────────────
export {
  validateAdapterSecrets,
  executeSwarm,
  writeCIOutputs,
  handleBootstrapCommand,
  handleSwarmCommand,
  handleQuickCommand,
  handleRunCommand,
} from './swarm-handlers';

// ── Status / reporting handlers ───────────────────────────────────────────
export {
  showStatus,
  handleStatusCommand,
  handleGatesCommand,
  handleAuditCommand,
  handleMetricsCommand,
  handleReportCommand,
} from './status-handlers';

// ── Demo / template handlers ─────────────────────────────────────────────
export {
  installDemoDependencies,
  handleDemoCommand,
  runDemo,
  handleTemplatesCommand,
} from './demo-handlers';

// ── Share handlers ───────────────────────────────────────────────────────
export { handleShareCommand } from './share-handlers';

// ── Misc handlers (recipes, agents, use) ─────────────────────────────────
export {
  handleUseCommand,
  handleRecipesCommand,
  handleRecipeInfoCommand,
  handleAgentsCommand,
} from './misc-handlers';

// ── Already-split modules (re-export for convenience) ────────────────────
export { showUsage } from './usage';
export { parseSwarmFlags } from './flags';
export type { ExecuteSwarmCliOptions } from './flags';
