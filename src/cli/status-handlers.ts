/**
 * Status / reporting CLI command handlers extracted from cli-handlers.ts.
 * Each handler validates its arguments, performs the work, and returns an
 * exit code (0 = success, 1 = failure). No handler calls process.exit.
 */

import * as fs from 'fs';
import * as path from 'path';
import { StepRunner } from '../step-runner';
import { SessionState } from '../types';
import { formatSarif } from '../sarif-formatter';
import {
  extractPositionalArgs,
  parseOutputFormat,
} from './flags';
import { showUsage } from './usage';
import { getLogger, writeStructuredOutput } from '../logger';

const logger = getLogger('cli:status');

// ---------------------------------------------------------------------------
// Internal helpers (not exported; called by the handle* functions)
// ---------------------------------------------------------------------------

export function showStatus(executionId: string, outputFormat: 'text' | 'json' = 'text'): number {
  if (outputFormat !== 'json') {
    logger.info('Swarm Orchestrator - Execution Status\n');
  }

  const runner = new StepRunner();

  try {
    const context = runner.loadExecutionContext(executionId);
    if (outputFormat === 'json') {
      const nextStep = context.stepResults.find(r => r.status === 'pending') || null;
      writeStructuredOutput({
        mode: 'sequential',
        executionId,
        status: context.stepResults.every(r => r.status === 'completed')
          ? 'completed'
          : context.stepResults.some(r => r.status === 'failed')
            ? 'failed'
            : 'in_progress',
        nextStep,
        context,
      });
    } else {
      const summary = runner.generateSummary(context);

      logger.info(summary);

      const nextStep = context.stepResults.find(r => r.status === 'pending');
      if (nextStep) {
        logger.info(`\nNext step: ${nextStep.stepNumber} (${nextStep.agentName})`);
        logger.info('Run execution command again to see instructions for this step.');
      } else {
        const allCompleted = context.stepResults.every(r => r.status === 'completed');
        if (allCompleted) {
          logger.info('\n✓ All steps completed!');
        } else {
          logger.info('\n⚠ Some steps failed or were skipped');
        }
      }
    }
    return 0;
  } catch {
    // Not a sequential execution context; fall through to swarm session state
  }

  const MetricsCollectorClass = require('../metrics-collector').default;
  const collector = new MetricsCollectorClass(executionId, '');
  const state = collector.loadSession(executionId) as SessionState | null;
  if (state) {
    const completed = state.lastCompletedStep;
    const total = state.graph.steps.length;
    if (outputFormat === 'json') {
      writeStructuredOutput({
        mode: 'swarm',
        executionId,
        sessionId: state.sessionId,
        status: state.status,
        completed,
        total,
        branches: Object.keys(state.branchMap).length,
        transcripts: Object.keys(state.transcripts).length,
        gateResults: state.gateResults,
        metrics: state.metrics,
      });
    } else {
      logger.info(`  Session:    ${state.sessionId}`);
      logger.info(`  Status:     ${state.status}`);
      logger.info(`  Progress:   ${completed}/${total} steps completed`);
      logger.info(`  Branches:   ${Object.keys(state.branchMap).length}`);
      logger.info(`  Transcripts:${Object.keys(state.transcripts).length}`);
      if (state.status === 'completed') {
        logger.info('\n✓ All steps completed!');
      } else if (state.status === 'failed') {
        logger.info('\n⚠ Execution failed. Use --resume to retry.');
      } else {
        logger.info(`\n⏳ ${state.status} at step ${completed + 1}`);
      }
    }
    return 0;
  }

  logger.error(`Execution not found: ${executionId}`);
  logger.error('Checked both proof/ (sequential) and runs/ (swarm) directories.');
  return 1;
}

// ---------------------------------------------------------------------------
// Command handlers (exported for testing and called by main dispatch)
// ---------------------------------------------------------------------------

export async function handleStatusCommand(args: string[]): Promise<number> {
  const executionId = extractPositionalArgs(args.slice(1), {
    booleanFlags: ['--verbose', '--json'],
    valueFlags: ['--output'],
  })[0];
  if (!executionId) {
    logger.error('Error: Execution ID required\n');
    showUsage();
    return 1;
  }

  try {
    return showStatus(executionId, parseOutputFormat(args));
  } catch (error) {
    logger.error('Error showing status:', error instanceof Error ? error.message : error);
    return 1;
  }
}

export async function handleGatesCommand(args: string[]): Promise<number> {
  const { load_quality_gates_config, run_quality_gates } = require('../quality-gates');
  const outputFormat = parseOutputFormat(args);

  const positional = extractPositionalArgs(args, {
    booleanFlags: ['--verbose', '--json'],
    valueFlags: ['--output', '--quality-gates-config', '--quality-gates-out', '--base-commit', '--sarif'],
  })[0];
  const projectRoot = positional ? path.resolve(process.cwd(), positional) : process.cwd();

  const configIndex = args.indexOf('--quality-gates-config');
  const configPath = configIndex !== -1 && args[configIndex + 1] ? args[configIndex + 1] : undefined;

  const outIndex = args.indexOf('--quality-gates-out');
  const outDir = outIndex !== -1 && args[outIndex + 1]
    ? path.resolve(process.cwd(), args[outIndex + 1])
    : undefined;

  // When a base commit is provided, compute baseline files so gates only flag
  // agent-created or agent-modified files, not pre-existing project code.
  const baseCommitIdx = args.indexOf('--base-commit');
  const baseCommitSha = baseCommitIdx !== -1 && args[baseCommitIdx + 1] ? args[baseCommitIdx + 1] : undefined;
  let baselineFiles: Set<string> | undefined;

  if (baseCommitSha) {
    try {
      const { execSync } = require('child_process');
      const fileList = execSync(`git ls-tree -r --name-only ${baseCommitSha}`, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      baselineFiles = new Set(fileList.trim().split('\n').filter(Boolean));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to read baseline files from commit ${baseCommitSha}: ${msg}`);
      return 1;
    }
  }

  const sarifIndex = args.indexOf('--sarif');
  const sarifPath = sarifIndex !== -1 && args[sarifIndex + 1] ? args[sarifIndex + 1] : undefined;
  if (outputFormat === 'json' && sarifPath === '-') {
    logger.error('Cannot combine --output json with --sarif -');
    return 1;
  }

  const config = load_quality_gates_config(projectRoot, configPath);
  const result = await run_quality_gates(projectRoot, config, outDir, baselineFiles, baseCommitSha);
  if (outputFormat === 'json') {
    writeStructuredOutput({
      projectRoot,
      configPath: configPath || null,
      outDir: outDir || null,
      baseCommitSha: baseCommitSha || null,
      ...result,
    });
  } else {
    // When SARIF goes to stdout, route status text to stderr to keep stdout clean
    const log = sarifPath === '-' ? logger.error : logger.info;
    const icon = result.passed ? '✅' : '❌';
    log(`${icon} quality gates ${result.passed ? 'passed' : 'failed'} (${result.totalDurationMs}ms)`);
    for (const gate of result.results) {
      const g = gate.status === 'pass' ? '✅' : gate.status === 'skip' ? '⏭️' : '❌';
      log(`  ${g} ${gate.id}: ${gate.issues.length} issue(s)`);
      if (gate.issues.length > 0) {
        for (const issue of gate.issues) {
          const loc = issue.filePath ? ` (${issue.filePath}${issue.line ? ':' + issue.line : ''})` : '';
          log(`     ${issue.message}${loc}`);
          if (issue.excerpt) {
            const trimmed = issue.excerpt.split('\n').slice(0, 5).join('\n');
            log(`     ${trimmed}`);
          }
        }
      }
    }
  }

  if (sarifPath) {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    const sarifOutput = formatSarif(result, pkg.version);

    if (sarifPath === '-') {
      process.stdout.write(sarifOutput + '\n');
    } else {
      const resolved = path.resolve(process.cwd(), sarifPath);
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        logger.error(`SARIF output directory does not exist: ${dir}`);
        return 1;
      }
      fs.writeFileSync(resolved, sarifOutput, 'utf8');
      logger.info(`SARIF report written to ${resolved}`);
    }
  }

  return result.passed ? 0 : 1;
}

export async function handleAuditCommand(args: string[]): Promise<number> {
  const sessionId = extractPositionalArgs(args.slice(1), {
    booleanFlags: ['--verbose', '--json'],
    valueFlags: ['--output'],
  })[0];
  if (!sessionId) {
    logger.error('Error: session ID required\nUsage: swarm audit <session-id>');
    return 1;
  }
  const MetricsCollectorClass = require('../metrics-collector').default;
  const collector = new MetricsCollectorClass(sessionId, '');
  const state: SessionState | null = collector.loadSession(sessionId);
  if (!state) {
    logger.error(`Session not found: ${sessionId}`);
    return 1;
  }
  logger.info(collector.generateAuditReport(state));
  return 0;
}

export async function handleMetricsCommand(args: string[]): Promise<number> {
  const sessionId = extractPositionalArgs(args.slice(1), {
    booleanFlags: ['--verbose', '--json'],
    valueFlags: ['--output'],
  })[0];
  if (!sessionId) {
    logger.error('Error: session ID required\nUsage: swarm metrics <session-id>');
    return 1;
  }
  const MetricsCollectorClass = require('../metrics-collector').default;
  const collector = new MetricsCollectorClass(sessionId, '');
  const state: SessionState | null = collector.loadSession(sessionId);
  if (!state) {
    logger.error(`Session not found: ${sessionId}`);
    return 1;
  }

  const steps = state.graph.steps.length;
  const completed = state.lastCompletedStep;
  const branches = Object.keys(state.branchMap).length;
  const transcripts = Object.keys(state.transcripts).length;
  const gatesPassed = state.gateResults.filter(g => g.status === 'pass').length;
  const gatesFailed = state.gateResults.filter(g => g.status !== 'pass').length;
  const premiumReqs = Number(state.metrics['premiumRequests'] ?? 0);
  const totalMs = Number(state.metrics['totalTimeMs'] ?? 0);

  if (parseOutputFormat(args) === 'json') {
    writeStructuredOutput({
      sessionId: state.sessionId,
      status: state.status,
      steps, completed, branches, transcripts,
      gatesPassed, gatesFailed, premiumReqs,
      totalTimeMs: totalMs
    });
  } else {
    logger.info(`\n  Session Metrics: ${state.sessionId}\n  ${'─'.repeat(50)}`);
    logger.info(`  Status:          ${state.status}`);
    logger.info(`  Steps:           ${completed}/${steps} completed`);
    logger.info(`  Branches:        ${branches}`);
    logger.info(`  Transcripts:     ${transcripts}`);
    logger.info(`  Gates:           ${gatesPassed} passed, ${gatesFailed} failed`);
    logger.info(`  Premium requests:${premiumReqs}`);
    if (totalMs > 0) {
      const sec = Math.round(totalMs / 1000);
      logger.info(`  Wall time:       ${sec}s`);
    }
    logger.info(`  ${'─'.repeat(50)}\n`);
  }
  return 0;
}

export async function handleReportCommand(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    logger.info(`
Usage: swarm report <run-id> [flags]

Generate a structured run report from existing run artifacts.

Arguments:
  <run-id>   The run directory name (e.g., swarm-2026-04-08T05-23-52-947Z)

Flags:
  --format <md|json>   Output format (default: both)
  --stdout             Print to terminal instead of writing files
  --latest             Use the most recent run directory

Examples:
  swarm report swarm-2026-04-08T05-23-52-947Z
  swarm report --latest --format md --stdout
  swarm report --latest
`);
    return 0;
  }

  const useLatest = args.includes('--latest');
  const toStdout = args.includes('--stdout');

  const formatIdx = args.indexOf('--format');
  let format: 'md' | 'json' | 'both' = 'both';
  if (formatIdx !== -1 && args[formatIdx + 1]) {
    const val = args[formatIdx + 1];
    if (val !== 'md' && val !== 'json') {
      logger.error(`--format requires "md" or "json", got "${val}"`);
      return 1;
    }
    format = val;
  }

  let runDir: string;

  if (useLatest) {
    const runsRoot = path.join(process.cwd(), 'runs');
    if (!fs.existsSync(runsRoot)) {
      logger.error(`No runs/ directory found in ${process.cwd()}`);
      return 1;
    }
    const entries = fs.readdirSync(runsRoot, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort()
      .reverse();
    if (entries.length === 0) {
      logger.error('No run directories found in runs/');
      return 1;
    }
    runDir = path.join(runsRoot, entries[0]);
  } else {
    const runId = args.find(a => !a.startsWith('--') && a !== 'report');
    if (!runId) {
      logger.error('Error: run-id required (or use --latest)');
      logger.error('Usage: swarm report <run-id>');
      return 1;
    }
    runDir = path.join(process.cwd(), 'runs', runId);
    if (!fs.existsSync(runDir)) {
      // Try as absolute path
      runDir = runId;
    }
  }

  if (!fs.existsSync(runDir)) {
    logger.error(`Run directory not found: ${runDir}`);
    return 1;
  }

  const { ReportGenerator } = await import('../report-generator');
  const { ReportRenderer } = await import('../report-renderer');

  let report;
  try {
    const generator = new ReportGenerator();
    report = generator.generate(runDir);
  } catch (err) {
    logger.error(`Failed to generate report: ${err instanceof Error ? err.message : err}`);
    return 1;
  }

  const md = ReportRenderer.toMarkdown(report);
  const json = ReportRenderer.toJson(report);

  if (toStdout) {
    if (format === 'md' || format === 'both') logger.info(md);
    if (format === 'json' || format === 'both') logger.info(json);
  } else {
    if (format === 'md' || format === 'both') {
      const mdPath = path.join(runDir, 'report.md');
      fs.writeFileSync(mdPath, md);
      logger.info(`Report written: ${mdPath}`);
    }
    if (format === 'json' || format === 'both') {
      const jsonPath = path.join(runDir, 'report.json');
      fs.writeFileSync(jsonPath, json);
      logger.info(`Report written: ${jsonPath}`);
    }
  }

  const summary = ReportRenderer.toSummaryLine(report);
  logger.info(summary);

  return 0;
}
