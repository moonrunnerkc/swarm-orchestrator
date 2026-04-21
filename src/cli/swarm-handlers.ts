/**
 * Swarm/execution-related CLI command handlers extracted from cli-handlers.ts.
 * Each handler validates its arguments, performs the work, and returns an
 * exit code (0 = success, 1 = failure). No handler calls process.exit.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConfigLoader } from '../config-loader';
import { ExecutionPlan, PlanGenerator } from '../plan-generator';
import { PlanStorage } from '../plan-storage';
import QuickFixMode, { QuickFixOptions } from '../quick-fix-mode';
import { SwarmOrchestrator, SwarmExecutionOptions, SwarmExecutionContext } from '../swarm-orchestrator';
import { defaultModelForAdapter } from '../adapters';
import { confirmCostPrompt } from './cost-prompt';
import {
  ExecuteSwarmCliOptions,
  parseSwarmFlags,
} from './flags';
import { showUsage } from './usage';
import { Spinner } from '../spinner';
import { getLogger, isPrettyMode, setDashboardActive } from '../logger';

const logger = getLogger('cli:swarm');

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

// Checked before execution so users get clear guidance instead of cryptic
// auth failures deep in the agent subprocess.
// Copilot authenticates via `gh auth login` (filesystem credentials),
// so it has no hard env var requirement. GITHUB_TOKEN is only used
// in CI where Actions provides it automatically.
// Claude Code supports both API key auth and subscription auth (via `claude login`).
// Only codex strictly requires an env var.
const ADAPTER_REQUIRED_KEYS: Record<string, string[]> = {
  codex: ['OPENAI_API_KEY'],
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function validateAdapterSecrets(tool: string): void {
  const required = ADAPTER_REQUIRED_KEYS[tool];
  if (!required) return;

  const missing = required.filter(k => !process.env[k]);
  if (missing.length === 0) return;

  const lines = [
    `Missing required secrets for --tool ${tool}: ${missing.join(', ')}`,
    '',
    'Set them in your environment or GitHub Secrets:',
    ...missing.map(k => `  ${k}=<your-key>`),
    '',
    'In a GitHub Actions workflow, pass them via the env: block:',
    ...missing.map(k => `  ${k}: \${{ secrets.${k} }}`),
  ];
  throw new Error(lines.join('\n'));
}

export async function executeSwarm(
  planFilename: string,
  options?: ExecuteSwarmCliOptions
): Promise<number> {
  const selectedTool = options?.cliAgent || 'copilot';
  validateAdapterSecrets(selectedTool);

  const storage = new PlanStorage();
  let plan = storage.loadPlan(planFilename);

  // In pretty mode (demo commands) the caller has already printed its own
  // banner with the goal + step count — don't duplicate.
  if (!isPrettyMode()) {
    logger.info('🐝 Swarm Orchestrator - Parallel Execution\n');
    logger.info(`Goal: ${plan.goal}`);
    logger.info(`Total Steps: ${plan.steps.length}\n`);
  }

  const configLoader = new ConfigLoader();
  const agents = configLoader.loadAllAgents();
  const agentMap = configLoader.buildAgentMap();

  // PM agent review (optional, activated with --pm)
  if (options?.pm) {
    const { PMAgent } = await import('../pm-agent');
    const pmAgent = new PMAgent(agents);
    logger.info('📋 PM Agent: Reviewing plan...');
    const pmResult = pmAgent.reviewPlan(plan);

    if (pmResult.reviewNotes.length > 0) {
      logger.info('  Review notes:');
      pmResult.reviewNotes.forEach((note: string) => logger.info(`    - ${note}`));
    }
    if (pmResult.changesApplied.length > 0) {
      logger.info('  Changes applied:');
      pmResult.changesApplied.forEach((change: string) => logger.info(`    - ${change}`));
    }
    if (pmResult.reviewNotes.length === 0 && pmResult.changesApplied.length === 0) {
      logger.info('  Plan approved with no issues.');
    }

    plan = pmResult.revisedPlan;
    logger.info('');
  }

  // Cost estimation (always runs pre-execution)
  const { CostEstimator } = await import('../cost-estimator');
  const costEstimator = new CostEstimator();
  const modelName = options?.model || defaultModelForAdapter(options?.cliAgent);
  const costEstimate = costEstimator.estimate(plan, {
    modelName,
    fleetMode: !!options?.useInnerFleet,
    qualityGatesEnabled: !options?.noQualityGates,
  });

  const retryPct = Math.round((costEstimate.perStep[0]?.retryProbability ?? 0.15) * 100);
  logger.info(`\n💰 Cost Estimate: ${costEstimate.lowEstimate}-${costEstimate.totalPremiumRequests} premium requests`);
  logger.info(`   ${plan.steps.length} steps | ${modelName} (${costEstimate.modelMultiplier}x) | ${retryPct}% retry buffer`);
  if (costEstimate.remediationBuffer > 0) {
    logger.info(`   includes ${costEstimate.remediationBuffer} remediation buffer (quality gates enabled)`);
  }
  if (options?.useInnerFleet) {
    logger.info(`   /fleet mode: subagent multiplier applied`);
  }
  logger.info('');

  if (options?.costEstimateOnly) {
    logger.info(`Cost Estimate for: ${plan.goal}`);
    logger.info(`Steps: ${plan.steps.length} | Model: ${modelName} (${costEstimate.modelMultiplier}x multiplier)`);
    logger.info(`Estimated premium requests: ${costEstimate.lowEstimate}-${costEstimate.highEstimate}`);
    logger.info(`Retry buffer (${retryPct}% historical failure rate): +${costEstimate.retryBuffer}`);
    logger.info(`Total estimate: ${costEstimate.lowEstimate}-${costEstimate.totalPremiumRequests} premium requests`);
    if (costEstimate.remainingAllowance !== undefined) {
      logger.info(`At $0.04/overage: $${costEstimate.overageCostUSD.toFixed(2)} if over allowance`);
    }
    logger.info('');
    return 0;
  }

  if (options?.maxPremiumRequests !== undefined && costEstimate.totalPremiumRequests > options.maxPremiumRequests) {
    logger.error(
      `Aborting: estimated ${costEstimate.totalPremiumRequests} premium requests exceeds budget of ${options.maxPremiumRequests}`
    );
    return 1;
  }

  // Pre-flight auth check: verify credentials before asking the user to confirm cost.
  // This prevents the confusing UX of confirming a spend and then immediately failing on auth.
  if (selectedTool === 'copilot') {
    try {
      const { execSync } = await import('child_process');
      execSync('gh auth status', { stdio: 'pipe', timeout: 10_000 });
    } catch {
      logger.error('❌ GitHub authentication check failed.');
      logger.error('   Run `gh auth login` or `copilot /login` to re-authenticate.');
      logger.error('   If using a token, ensure GH_TOKEN / GITHUB_TOKEN is set and valid.');
      return 1;
    }
  }

  // Gate: require explicit user confirmation before spending tokens
  const confirmed = await confirmCostPrompt(
    costEstimate.lowEstimate,
    costEstimate.totalPremiumRequests,
    modelName,
    !!options?.yes
  );
  if (!confirmed) {
    logger.info('Cancelled.');
    return 0;
  }

  // Resolve the target repo directory: plan metadata > CLI flag > first step repo > plan file location > cwd
  // When the plan file sits under <project>/plans/, infer <project> as the target.
  let inferredFromPlan: string | undefined;
  if (path.isAbsolute(planFilename)) {
    const planDir = path.dirname(planFilename);
    if (path.basename(planDir) === 'plans') {
      inferredFromPlan = path.dirname(planDir);
    }
  }

  const targetDir = plan.metadata?.targetDir
    || options?.targetDir
    || plan.steps.find(s => s.repo)?.repo
    || inferredFromPlan
    || undefined;

  if (targetDir) {
    logger.info(`📂 Target directory: ${targetDir}`);
  }

  const orchestrator = new SwarmOrchestrator(targetDir);

  const runId = `swarm-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const baseDir = targetDir || process.cwd();
  const runDir = path.join(baseDir, 'runs', runId);

  if (isPrettyMode()) {
    // Demo: only the run dir is useful, and dim so it doesn't compete.
    logger.info(`  Run: ${runDir}\n`);
  } else {
    logger.info(`Run ID: ${runId}`);
    logger.info(`Run Directory: ${runDir}\n`);
  }

  // Dashboard: Ink 4+ is ESM-only; bridge via dynamic import()
  let dashboard: { update: (updates: Record<string, unknown>) => void; stop: () => void } | undefined;
  if (!options?.noDashboard) {
    try {
      const dashboardModule = await import('../dashboard');
      const startDashboard = dashboardModule.startDashboard;
      const result = await startDashboard({
        executionId: runId,
        goal: plan.goal,
        totalSteps: plan.steps.length,
        currentWave: 0,
        totalWaves: plan.steps.length > 0 ? 1 : 0,
        results: plan.steps.map(s => ({
          stepNumber: s.stepNumber,
          agentName: s.agentName,
          status: 'pending' as const,
        })),
        recentCommits: [],
        prLinks: [],
        startTime: new Date().toISOString(),
        agentLog: [],
        costSummary: `Cost Estimate: ${costEstimate.lowEstimate}-${costEstimate.totalPremiumRequests} premium requests | ${modelName} (${costEstimate.modelMultiplier}x) | ${plan.steps.length} steps`
      });
      if (result) {
        dashboard = result;
        setDashboardActive(true);
        logger.info('📊 Live TUI dashboard started\n');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('raw mode') || msg.includes('setRawMode')) {
        logger.info('ℹ️  TUI dashboard unavailable (terminal does not support raw mode); continuing without dashboard\n');
      } else {
        logger.info('ℹ️  Live dashboard unavailable (Ink ESM import failed); continuing without dashboard\n');
      }
    }
  } else if (!isPrettyMode()) {
    // Demo commands set noDashboard=true internally; no need to surface
    // the disabled-dashboard banner to end users.
    logger.info('ℹ️  Dashboard disabled via --no-dashboard\n');
  }

  try {
    const swarmOptions: SwarmExecutionOptions = {};
    if (options?.model) swarmOptions.model = options.model;
    if (options?.confirmDeploy) swarmOptions.confirmDeploy = true;
    if (options?.noQualityGates) swarmOptions.qualityGates = false;
    if (options?.governance) swarmOptions.governance = true;
    if (options?.strictIsolation) swarmOptions.strictIsolation = true;
    if (options?.lean) swarmOptions.lean = true;
    if (options?.useInnerFleet) swarmOptions.useInnerFleet = true;
    if (options?.fleetWaveMode) swarmOptions.fleetWaveMode = true;
    if (options?.prMode) swarmOptions.prMode = options.prMode;
    if (options?.hooksEnabled !== undefined) swarmOptions.hooksEnabled = options.hooksEnabled;
    if (options?.owaspReport) swarmOptions.owaspReport = true;
    if (options?.cliAgent) swarmOptions.cliAgent = options.cliAgent;
    if (options?.teamSize) swarmOptions.teamSize = options.teamSize;

    if (dashboard) {
      // Capture live agent output lines for the dashboard log panel
      const agentLogLines: string[] = [];
      swarmOptions.onAgentLine = (line: string) => {
        agentLogLines.push(line);
        // Keep a rolling window to avoid unbounded memory growth
        if (agentLogLines.length > 200) agentLogLines.splice(0, agentLogLines.length - 200);
        dashboard!.update({ agentLog: agentLogLines.slice(-12) });
      };

      swarmOptions.onProgress = (ctx: SwarmExecutionContext, event: string) => {
        const waveMatch = event.match(/^wave-(?:start|done):(\d+)/);
        const currentWave = waveMatch ? parseInt(waveMatch[1], 10) : undefined;

        const liveQueueStats = ctx.executionQueue?.getStats?.() || ctx.queueStats;

        dashboard!.update({
          results: ctx.results,
          totalSteps: ctx.plan.steps.length,
          ...(currentWave !== undefined && { currentWave }),
          ...(ctx.totalWaves && { totalWaves: ctx.totalWaves }),
          ...(ctx.criticResults && { criticResults: ctx.criticResults }),
          ...(ctx.leanSavedRequests && { leanSavedRequests: ctx.leanSavedRequests }),
          ...(liveQueueStats && { queueStats: liveQueueStats }),
        });
      };
    }

    const context = await orchestrator.executeSwarm(plan, agentMap, runDir, swarmOptions);

    if (dashboard) {
      dashboard.update({
        currentWave: context.totalWaves || 1,
        totalSteps: context.results.length,
        results: context.results
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
      dashboard.stop();
      setDashboardActive(false);
    }

    const completed = context.results.filter(r => r.status === 'completed').length;
    const failed = context.results.filter(r => r.status === 'failed').length;
    const totalSteps = context.results.length;
    const actualPremiumRequests = context.stepCostRecords?.reduce((sum, record) => sum + record.actualPremiumRequests, 0) ?? 0;
    const estimateDeltaRatio = costEstimate.totalPremiumRequests > 0
      ? (actualPremiumRequests - costEstimate.totalPremiumRequests) / costEstimate.totalPremiumRequests
      : 0;
    const gateResults = context.finalGateResults || [];
    const gatesPassed = gateResults.filter(g => g.status === 'pass').length;
    const gatesFailed = gateResults.filter(g => g.status === 'fail').length;
    const remediationSteps = Math.max(0, totalSteps - plan.steps.length);

    logger.info('\n' + '═'.repeat(60));
    logger.info('  SWARM EXECUTION COMPLETE');
    logger.info('═'.repeat(60));
    logger.info(`\n  ✅ Completed: ${completed}/${totalSteps}`);

    if (failed > 0) {
      logger.info(`  ❌ Failed: ${failed}/${totalSteps}`);
      logger.info('\n  Failed steps:');
      context.results
        .filter(r => r.status === 'failed')
        .forEach(r => {
          logger.info(`    - Step ${r.stepNumber} (${r.agentName}): ${r.error}`);
        });
    }

    const starts = context.results.filter(r => r.startTime).map(r => new Date(r.startTime!).getTime());
    const ends = context.results.filter(r => r.endTime).map(r => new Date(r.endTime!).getTime());
    if (starts.length > 0 && ends.length > 0) {
      const totalSec = Math.round((Math.max(...ends) - Math.min(...starts)) / 1000);
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      logger.info(`  ⏱  Total time: ${min > 0 ? `${min}m ${sec}s` : `${sec}s`}`);
    }

    logger.info(`\n  💰 Actual cost: ${actualPremiumRequests} premium requests`);
    logger.info(`     estimate: ${costEstimate.lowEstimate}-${costEstimate.totalPremiumRequests} | ${modelName} (${costEstimate.modelMultiplier}x) | ${totalSteps} steps${remediationSteps > 0 ? ` (${plan.steps.length} planned + ${remediationSteps} remediation)` : ''} | ${retryPct}% retry buffer`);
    if (estimateDeltaRatio > 0.2) {
      logger.info(`     ⚠ exceeded estimate by ${Math.round(estimateDeltaRatio * 100)}%`);
    }

    logger.info(`\n  📁 Artifacts: ${runDir}`);
    logger.info(`  📊 Reports: ${runDir}/verification/`);
    if (gateResults.length > 0) {
      logger.info(`  🧪 Quality gates: ${gatesPassed} passed, ${gatesFailed} failed`);
    }

    // Show PR URLs if --pr mode was active
    if (context.prUrls && context.prUrls.size > 0) {
      logger.info('\n  Pull Requests:');
      for (const [stepNum, url] of context.prUrls) {
        logger.info(`    Step ${stepNum}: ${url}`);
      }
    }

    logger.info('═'.repeat(60));

    if (failed > 0) {
      logger.info(`\nInspect failed run: swarm report ${runId}`);
    } else if (completed === totalSteps) {
      logger.info('\n🎉 All steps completed successfully!');
      logger.info('   Review the git log to see the natural commit history:');
      logger.info('   git log --oneline -20\n');
    }

    // CI output: write structured result when running inside GitHub Actions
    const allPassed = context.results.every(r => r.verificationResult?.passed) && gatesFailed === 0;
    if (process.env.GITHUB_ACTIONS) {
      writeCIOutputs(context, plan, allPassed);
    }

    return allPassed ? 0 : 1;
  } catch (error) {
    if (dashboard) {
      dashboard.stop();
      setDashboardActive(false);
    }
    throw error;
  }
}

/**
 * Write CI-specific output files when running inside GitHub Actions.
 * These feed into action.yml outputs via GITHUB_OUTPUT.
 */
export function writeCIOutputs(
  context: SwarmExecutionContext,
  plan: ExecutionPlan,
  allPassed: boolean
): void {
  const starts = context.results.filter(r => r.startTime).map(r => new Date(r.startTime!).getTime());
  const ends = context.results.filter(r => r.endTime).map(r => new Date(r.endTime!).getTime());
  const totalDurationMs = (starts.length > 0 && ends.length > 0)
    ? Math.max(...ends) - Math.min(...starts)
    : 0;

  const resultJson = {
    allPassed,
    totalSteps: context.results.length,
    completed: context.results.filter(r => r.status === 'completed').length,
    failed: context.results.filter(r => r.status === 'failed').length,
    totalDurationMs,
    steps: context.results.map(r => ({
      stepNumber: r.stepNumber,
      agentName: r.agentName,
      status: r.status,
      passed: r.verificationResult?.passed ?? false,
      retryCount: r.retryCount ?? 0,
    })),
  };

  fs.writeFileSync('/tmp/swarm-result.json', JSON.stringify(resultJson), 'utf8');
  fs.writeFileSync('/tmp/swarm-plan.json', JSON.stringify(plan, null, 2), 'utf8');

  // Write first PR URL if present
  if (context.prUrls && context.prUrls.size > 0) {
    const firstUrl = context.prUrls.values().next().value;
    if (firstUrl) {
      fs.writeFileSync('/tmp/swarm-pr-url.txt', firstUrl, 'utf8');
    }
  }
}

// ---------------------------------------------------------------------------
// Exported command handlers
// ---------------------------------------------------------------------------

export async function handleBootstrapCommand(args: string[]): Promise<number> {
  if (args.length < 3) {
    logger.error('Usage: swarm bootstrap <repo-path> [<repo-path2> ...] "Goal description"');
    return 1;
  }

  // Extract positional args, skipping flags and their values
  const flagsWithValues = new Set([
    '--tool', '--model', '--resume', '--pr', '--target', '--dir',
    '--quality-gates-config', '--quality-gates-out', '--max-premium-requests',
  ]);
  const positional: string[] = [];
  const raw = args.slice(1);
  for (let i = 0; i < raw.length; i++) {
    if (flagsWithValues.has(raw[i])) {
      i++; // skip the flag's value
    } else if (!raw[i].startsWith('--')) {
      positional.push(raw[i]);
    }
  }

  if (positional.length < 2) {
    logger.error('Usage: swarm bootstrap <repo-path> [<repo-path2> ...] "Goal description"');
    return 1;
  }

  const repoPaths = positional.slice(0, -1);
  const goal = positional[positional.length - 1];

  for (const repoPath of repoPaths) {
    if (!fs.existsSync(repoPath)) {
      logger.error(`Repository path does not exist: ${repoPath}`);
      return 1;
    }
  }

  logger.info('╔══════════════════════════════════════════════════════════════════════╗');
  logger.info('║  BOOTSTRAP MODE - Multi-Repo Analysis & Planning                     ║');
  logger.info('╚══════════════════════════════════════════════════════════════════════╝\n');

  const BootstrapOrchestrator = require('../bootstrap-orchestrator').default;
  const storage = new PlanStorage();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const goalSlug = goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30);
  const runId = `bootstrap-${timestamp}-${goalSlug}`;
  const runDir = path.join(process.cwd(), 'runs', runId);

  try {
    const orchestrator = new BootstrapOrchestrator();
    const bsSpinner = new Spinner('Analyzing repos...', { style: 'dots', prefix: '  ' });
    bsSpinner.start();
    let bootstrapResult: { evidencePath: string; plan: ExecutionPlan };
    try {
      bootstrapResult = await orchestrator.bootstrap(repoPaths, goal, runDir) as {
        evidencePath: string;
        plan: ExecutionPlan;
      };
    } finally {
      bsSpinner.stop();
    }
    const { evidencePath, plan } = bootstrapResult;

    const planPath = storage.savePlan(plan, runId);

    logger.info('📋 Bootstrap Results:');
    logger.info(`  Evidence: ${evidencePath}`);
    logger.info(`  Plan: ${planPath}`);
    logger.info(`  Run ID: ${runId}`);
    logger.info('');
    logger.info('Next steps:');
    logger.info(`  1. Review the evidence: cat ${evidencePath}`);
    logger.info(`  2. Execute the plan: swarm swarm ${planPath}`);
    return 0;
  } catch (error) {
    logger.error('Bootstrap failed:', error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function handleSwarmCommand(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    logger.info(`
Usage: swarm swarm <planfile> [flags]

Execute a plan in parallel swarm mode. Runs steps concurrently based on
their dependency graph, verifying each step with evidence-based checks.

Arguments:
  <planfile>   Path to a plan JSON file (from \`swarm plan\` or \`swarm run\`)

Flags:
  --model <name>             Model to use (e.g., claude-opus-4.5, o3)
  --no-dashboard             Disable the live TUI dashboard
  --pm                       Run PM agent plan review before execution
  --governance               Enable critic review + governance pause before merge
  --strict-isolation         Force per-task branch isolation
  --lean                     Enable Delta Context Engine (reuse KB patterns)
  --useInnerFleet            Prefix all prompts with /fleet
  --fleet                    Dispatch waves via /fleet (hybrid mode)
  --cost-estimate-only       Print cost estimate and exit without executing
  --max-premium-requests <n> Abort if estimated cost exceeds budget
  --plan-cache               Skip planning when a cached template matches
  --replay                   Reuse prior transcripts for identical steps
  --pr <auto|review>         Create PRs instead of direct merge
  --target <dir>             Run in specified directory instead of cwd
  --resume <id>              Resume a paused or failed session
  --hooks / --no-hooks       Enable/disable per-step hook injection
  --owasp-report             Generate OWASP ASI compliance report
  --tool <name>              Agent tool: copilot, claude-code, claude-code-teams
  --team-size <n>            Max concurrent teammates (claude-code-teams, 1-5)

Examples:
  swarm swarm plan.json
  swarm swarm plan.json --model claude-opus-4.5 --pm
  swarm swarm plan.json --cost-estimate-only
  swarm swarm plan.json --pr auto --governance
`);
    return 0;
  }

  if (args.length < 2 || !args[1]) {
    logger.error('Error: Plan filename required\n');
    showUsage();
    return 1;
  }

  const planFilename = args[1];
  try {
    const options = parseSwarmFlags(args);
    return await executeSwarm(planFilename, options);
  } catch (error) {
    logger.error('Error executing swarm:', error instanceof Error ? error.message : error);
    return 1;
  }
}

export async function handleQuickCommand(args: string[]): Promise<number> {
  if (args.length < 2) {
    logger.error('Error: Quick-fix mode requires a task');
    logger.info('Usage: swarm quick "task description"');
    logger.info('Example: swarm quick "fix typo in README"');
    return 1;
  }

  const task = args[1];
  const flags = {
    model: args.includes('--model') ? args[args.indexOf('--model') + 1] : undefined,
    agent: args.includes('--agent') ? args[args.indexOf('--agent') + 1] : undefined,
    tool: args.includes('--tool') ? args[args.indexOf('--tool') + 1] : undefined,
    skipVerify: args.includes('--skip-verify'),
    yes: args.includes('--yes') || args.includes('-y')
  };

  const quickFix = new QuickFixMode();

  logger.info('⚡ Quick-Fix Mode\n');

  const quickModel = flags.model || defaultModelForAdapter(flags.tool);
  const { CostEstimator } = require('../cost-estimator') as typeof import('../cost-estimator');
  const quickCostEstimator = new CostEstimator();
  const quickEstimate = quickCostEstimator.estimate(
    {
      goal: task,
      createdAt: new Date().toISOString(),
      steps: [{
        stepNumber: 1,
        agentName: flags.agent || 'backend_master',
        task,
        dependencies: [],
        expectedOutputs: []
      }]
    },
    { modelName: quickModel }
  );
  logger.info(`💰 Cost Estimate: ${quickEstimate.lowEstimate}-${quickEstimate.totalPremiumRequests} premium requests`);
  logger.info(`   1 step | ${quickModel} (${quickEstimate.modelMultiplier}x)\n`);

  // Gate: require explicit user confirmation before spending tokens
  const quickConfirmed = await confirmCostPrompt(
    quickEstimate.lowEstimate,
    quickEstimate.totalPremiumRequests,
    quickModel,
    flags.yes
  );
  if (!quickConfirmed) {
    logger.info('Cancelled.');
    return 0;
  }

  const quickOpts: QuickFixOptions = {
    skipVerification: flags.skipVerify
  };
  if (flags.model) quickOpts.model = flags.model;
  if (flags.agent) quickOpts.agent = flags.agent;

  const result = await quickFix.execute(task, quickOpts);

  if (!result.wasQuickFixEligible) {
    logger.info(result.output);
    return 1;
  }

  if (result.success) {
    logger.info(`\n✅ Quick-fix completed in ${(result.duration / 1000).toFixed(1)}s`);
    logger.info(`   Agent: ${result.agentUsed}`);

    if (result.verificationPassed !== undefined) {
      logger.info(`   Verification: ${result.verificationPassed ? '✓ Passed' : '✗ Failed'}`);
    }
    return 0;
  }

  logger.error(`\n❌ Quick-fix failed (${(result.duration / 1000).toFixed(1)}s)`);
  logger.error(`   Agent: ${result.agentUsed}`);
  if (result.reason) {
    logger.error(`   Reason: ${result.reason}`);
  }
  return 1;
}

export async function handleRunCommand(args: string[]): Promise<number> {
  // Flags that consume the next token as a value (must be skipped during goal extraction)
  const valuedFlags = new Set([
    '--model', '--resume', '--quality-gates-config', '--quality-gates-out',
    '--pr', '--target', '--dir', '--tool', '--team-size', '--max-premium-requests',
    '--sarif', '--goal', '--base-commit',
  ]);

  // Extract positional tokens: skip the command name (args[0]) and any flag + value pairs
  const positional: string[] = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--') || args[i] === '-y') {
      if (valuedFlags.has(args[i]) && i + 1 < args.length) i++; // skip the value
      continue;
    }
    positional.push(args[i]);
  }

  // If --goal is explicit, extract its value directly
  const goalIndex = args.indexOf('--goal');
  let goal = '';
  if (goalIndex !== -1) {
    const afterGoal = args.slice(goalIndex + 1);
    const tokens: string[] = [];
    for (const tok of afterGoal) {
      if (tok.startsWith('--')) break;
      tokens.push(tok);
    }
    goal = tokens.join(' ');
  }

  // Detect plan file: if the first positional arg resolves to an existing file, execute it directly
  const firstPositional = positional[0];
  if (!goal && firstPositional) {
    let isPlanFile = false;
    const resolved = path.resolve(process.cwd(), firstPositional);

    // Check as a direct path (absolute or relative from cwd)
    if (fs.existsSync(resolved)) {
      try {
        JSON.parse(fs.readFileSync(resolved, 'utf8'));
        isPlanFile = true;
      } catch {
        // Exists but not valid JSON; not a plan file
      }
    }

    // Check under plans/ directory for bare filenames
    if (!isPlanFile) {
      const storage = new PlanStorage();
      try {
        storage.loadPlan(firstPositional);
        isPlanFile = true;
      } catch {
        // Not found in plans/ either; not a plan file
      }
    }

    if (isPlanFile) {
      logger.info('🐝 Swarm Orchestrator - Execute Plan\n');
      try {
        const options = parseSwarmFlags(args);
        return await executeSwarm(firstPositional, options);
      } catch (error) {
        logger.error('Error:', error instanceof Error ? error.message : error);
        return 1;
      }
    }
  }

  // No plan file detected; use positional tokens as goal (or --goal value)
  if (!goal) {
    goal = positional.join(' ');
  }

  if (!goal) {
    logger.error('Error: goal required\nUsage: swarm run --goal "Build a REST API"\n       swarm run <planfile> [flags]');
    return 1;
  }

  logger.info('🐝 Swarm Orchestrator - Plan & Execute\n');
  logger.info(`Goal: ${goal}\n`);

  const configLoader = new ConfigLoader();
  const agents = configLoader.loadAllAgents();
  const generator = new PlanGenerator(agents);
  const usePlanCache = args.includes('--plan-cache');
  const plan = generator.createPlan(goal, undefined, { planCache: usePlanCache });

  const storage = new PlanStorage();
  const planFilename = storage.savePlan(plan);
  logger.info(`Plan saved: ${planFilename} (${plan.steps.length} steps)\n`);

  try {
    const options = parseSwarmFlags(args);
    return await executeSwarm(path.basename(planFilename), options);
  } catch (error) {
    logger.error('Error:', error instanceof Error ? error.message : error);
    return 1;
  }
}
