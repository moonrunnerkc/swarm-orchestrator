/**
 * Phase 3c: state mutation audit.
 *
 * Static analysis tool that walks the executeSwarm method in
 * src/swarm-orchestrator.ts, extracts the call sequence to the
 * extracted orchestrator/* modules, and verifies cross-module
 * read/write ordering against the shared state map in
 * docs/decomposition-plan.md.
 *
 * Not a runtime test. Not a unit test. Not part of the gate. Its
 * output is a table + violation list written to stdout; callers can
 * pipe into docs/phase-3-ordering-violations.md if violations are
 * found.
 *
 * Usage: npx tsx scripts/verify/state-mutation-audit.ts
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ORCH_PATH = path.join(REPO_ROOT, 'src', 'swarm-orchestrator.ts');

interface CallStage {
  /** Human-readable label */
  label: string;
  /** Approximate line in executeSwarm where this stage fires */
  line: number;
  /** Module this stage delegates to, or '(inline)' */
  module: string;
  /** Fields on SwarmExecutionContext the stage reads */
  reads: string[];
  /** Fields on SwarmExecutionContext the stage writes (or mutates via method call) */
  writes: string[];
  /** True if this stage mutates context.plan by assignment */
  swapsPlan: boolean;
}

interface Invariant {
  label: string;
  /** Field that must be written before being read in the later stage */
  field: string;
  /** Index of the writer stage (0-based in the stages array) */
  writerIdx: number;
  /** Index of the reader stage that depends on the write */
  readerIdx: number;
}

/**
 * Parse executeSwarm from swarm-orchestrator.ts and return the
 * top-level call sequence. Walks line-by-line because the actual
 * body is ~220 lines — a full TS AST would be overkill, and a
 * regex-per-pattern sweep is traceable.
 */
function extractCallStages(src: string): CallStage[] {
  const lines = src.split('\n');
  const execStart = lines.findIndex(l => /^\s+async executeSwarm\b/.test(l));
  if (execStart === -1) throw new Error('could not find executeSwarm in swarm-orchestrator.ts');

  // Rough heuristic for end: the first line after execStart that starts
  // with "  }" at a single indent level + a preceding non-empty line
  // from inside the method. Sufficient for this audit — we read forward
  // until we hit the next top-level method or EOF.
  let execEnd = lines.length;
  for (let i = execStart + 1; i < lines.length; i++) {
    if (/^  \w/.test(lines[i]) || /^  async \w/.test(lines[i]) || /^  private \w/.test(lines[i])) {
      execEnd = i;
      break;
    }
  }

  const stages: CallStage[] = [];
  const body = lines.slice(execStart, execEnd).join('\n');
  const lineOffset = execStart;

  // Known markers. Each marker maps to a call stage. When a marker
  // matches, we record the stage with the absolute line number.
  const markers: Array<{
    pattern: RegExp;
    stage: (lineNum: number) => CallStage;
  }> = [
    {
      pattern: /this\.initializeSwarmExecution\(/,
      stage: line => ({
        label: 'initialize context',
        line,
        module: 'SwarmOrchestrator.initializeSwarmExecution',
        reads: ['plan'],
        writes: ['plan', 'runDir', 'executionId', 'startTime', 'results', 'contextBroker',
                 'mainBranch', 'metricsCollector', 'executionQueue', 'queueStats',
                 'waveResizer', 'adaptiveConcurrency', 'knowledgeBase', 'metaAnalyzer',
                 'waveAnalyses'],
        swapsPlan: false,
      }),
    },
    {
      pattern: /this\.sanitizeGitState\(\)/,
      stage: line => ({
        label: 'sanitize git state',
        line,
        module: 'orchestrator/git-state-utils',
        reads: [],
        writes: [],
        swapsPlan: false,
      }),
    },
    {
      pattern: /context\.agents = agents/,
      stage: line => ({
        label: 'attach agents to context',
        line,
        module: '(inline)',
        reads: [],
        writes: ['agents'],
        swapsPlan: false,
      }),
    },
    {
      pattern: /context\.qualityGatesTriggered = \{/,
      stage: line => ({
        label: 'seed qualityGatesTriggered flags',
        line,
        module: '(inline)',
        reads: [],
        writes: ['qualityGatesTriggered'],
        swapsPlan: false,
      }),
    },
    {
      pattern: /context\.totalWaves = executionWaves\.length/,
      stage: line => ({
        label: 'set initial totalWaves',
        line,
        module: '(inline)',
        reads: [],
        writes: ['totalWaves'],
        swapsPlan: false,
      }),
    },
    {
      pattern: /context\.costEstimate = costEstimator\.estimate/,
      stage: line => ({
        label: 'cost estimation',
        line,
        module: '(inline)',
        reads: ['knowledgeBase'],
        writes: ['costEstimator', 'costEstimate', 'stepCostRecords'],
        swapsPlan: false,
      }),
    },
    {
      pattern: /context\.baselineSnapshot = scanBaseline/,
      stage: line => ({
        label: 'scan baseline',
        line,
        module: '(inline)',
        reads: [],
        writes: ['baselineSnapshot'],
        swapsPlan: false,
      }),
    },
    {
      pattern: /context\.filteredRequirements = filtered/,
      stage: line => ({
        label: 'filter requirements',
        line,
        module: '(inline)',
        reads: [],
        writes: ['filteredRequirements'],
        swapsPlan: false,
      }),
    },
    {
      pattern: /await _runWaveLoop\(/,
      stage: line => ({
        label: 'SCHEDULER: run wave loop',
        line,
        module: 'orchestrator/wave-scheduler-loop',
        // The scheduler re-reads plan.steps every iteration, calls
        // host.executeStepInSwarm (step-executor) which mutates results,
        // and calls host.mergeWaveBranches which mutates unmergedBranches.
        reads: ['plan', 'knowledgeBase', 'executionQueue', 'metaAnalyzer', 'contextBroker'],
        writes: ['results', 'queueStats', 'totalWaves', 'criticResults',
                 'leanSavedRequests', 'stepCostRecords', 'unmergedBranches',
                 'waveAnalyses'],
        swapsPlan: false,
      }),
    },
    {
      pattern: /await this\.cleanupRemainingWorktrees/,
      stage: line => ({
        label: 'cleanup remaining worktrees',
        line,
        module: 'SwarmOrchestrator.cleanupRemainingWorktrees',
        reads: ['runDir'],
        writes: [],
        swapsPlan: false,
      }),
    },
    {
      pattern: /await this\.installDependenciesIfNeeded\(\);/,
      stage: line => ({
        label: 'install dependencies (post-scheduler)',
        line,
        module: 'orchestrator/git-state-utils',
        reads: [],
        writes: [],
        swapsPlan: false,
      }),
    },
    {
      // retriableFailures block spans 3 lines; match the lead-in
      pattern: /await this\.executeReplan\(\s*$/,
      stage: line => ({
        label: 'REPLAN: re-queue failed steps',
        line,
        module: 'orchestrator/replan-runner',
        reads: ['results', 'plan'],
        writes: ['results', 'replanState', 'knowledgeBase' /* addOrUpdatePattern */],
        swapsPlan: true, // assigns context.plan = revised
      }),
    },
    {
      pattern: /await _runFinalGatesPipeline\(/,
      stage: line => ({
        label: 'REMEDIATION: final gates pipeline',
        line,
        module: 'orchestrator/final-gates-remediation',
        // Reads: existing context state for baseline, filtered, flags, agents
        // Writes: finalGateResults (overwritten), qualityGatesTriggered flags
        // Calls executeReplan internally which may swap context.plan.
        reads: ['baselineSnapshot', 'filteredRequirements', 'qualityGatesTriggered',
                'agents', 'plan', 'results'],
        writes: ['finalGateResults', 'qualityGatesTriggered', 'plan', 'results',
                 'replanState', 'unmergedBranches'],
        swapsPlan: true, // via internal executeReplan
      }),
    },
    {
      pattern: /await this\.mergeAllBranches\(context\)/,
      stage: line => ({
        label: 'merge all branches',
        line,
        module: 'BranchMerger (via SwarmOrchestrator.mergeAllBranches)',
        reads: ['results', 'runDir', 'mainBranch', 'contextBroker'],
        writes: ['unmergedBranches'],
        swapsPlan: false,
      }),
    },
    {
      pattern: /await runPostExecution\(/,
      stage: line => ({
        label: 'POST-RUN: finalize metrics, cost, session state, OWASP, auto-PR',
        line,
        module: 'post-run-reporter',
        reads: ['metricsCollector', 'costEstimate', 'costEstimator', 'stepCostRecords',
                 'results', 'knowledgeBase', 'waveAnalyses', 'finalGateResults',
                 'baselineSnapshot', 'executionId', 'mainBranch', 'plan'],
        writes: [], // post-run writes to filesystem, not the context
        swapsPlan: false,
      }),
    },
  ];

  for (let i = 0; i < lines.length; i++) {
    if (i < execStart || i >= execEnd) continue;
    for (const m of markers) {
      if (m.pattern.test(lines[i])) {
        stages.push(m.stage(i + 1));
        // Do not break — a single line could match multiple markers,
        // though in practice each marker is unique.
      }
    }
  }

  // Dedupe by label+line, and also suppress repeated identical labels.
  // Some stages (e.g. installDependenciesIfNeeded) fire twice in
  // executeSwarm; we only show the first occurrence in the table and
  // annotate it.
  const seen = new Set<string>();
  const labelCounts = new Map<string, number>();
  const deduped: CallStage[] = [];
  for (const s of stages) {
    const key = `${s.label}@${s.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const count = (labelCounts.get(s.label) ?? 0) + 1;
    labelCounts.set(s.label, count);
    if (count === 1) {
      deduped.push(s);
    } else {
      // Annotate the first occurrence that this stage fires more than once.
      const first = deduped.find(d => d.label === s.label);
      if (first && !first.label.endsWith(')')) {
        first.label = `${first.label} (fires ${count}x)`;
      } else if (first) {
        first.label = first.label.replace(/\(fires \d+x\)$/, `(fires ${count}x)`);
      }
    }
  }

  deduped.sort((a, b) => a.line - b.line);
  return deduped;
}

/**
 * Invariants from the shared state map:
 *   - results[]: scheduler fires before reporter reads
 *   - plan.steps: replan swaps before scheduler re-reads (within-scheduler invariant,
 *       verified by test/wave-scheduler-replan.test.ts; flagged here as a static
 *       observation on the replan→scheduler ordering)
 *   - finalGateResults: remediation overwrites before reporter reads
 *   - metricsCollector: step-executor appends (via scheduler) before reporter flushes
 *   - stepCostRecords: step-executor appends (via scheduler) before reporter reads
 *   - qualityGatesTriggered: seeded before remediation mutates before reporter reads
 *       (reporter doesn't read this field, but remediation depends on the seed)
 */
function checkInvariants(stages: CallStage[]): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const indexByLabel = new Map<string, number>();
  stages.forEach((s, i) => indexByLabel.set(s.label, i));

  function requireWriterBefore(
    field: string,
    writerLabel: string,
    readerLabel: string,
    note: string,
  ) {
    const wIdx = indexByLabel.get(writerLabel);
    const rIdx = indexByLabel.get(readerLabel);
    if (wIdx === undefined) {
      violations.push(`missing writer stage "${writerLabel}" (field: ${field})`);
      return;
    }
    if (rIdx === undefined) {
      violations.push(`missing reader stage "${readerLabel}" (field: ${field})`);
      return;
    }
    if (wIdx >= rIdx) {
      violations.push(
        `ORDER VIOLATION: ${field}: writer "${writerLabel}" (stage ${wIdx + 1}) ` +
          `must precede reader "${readerLabel}" (stage ${rIdx + 1}). ${note}`,
      );
    }
  }

  requireWriterBefore(
    'results[]',
    'SCHEDULER: run wave loop',
    'POST-RUN: finalize metrics, cost, session state, OWASP, auto-PR',
    'Scheduler mutates status/branchName/timestamps via step-executor; post-run reads completed + failed.',
  );

  requireWriterBefore(
    'finalGateResults',
    'REMEDIATION: final gates pipeline',
    'POST-RUN: finalize metrics, cost, session state, OWASP, auto-PR',
    'Remediation overwrites after each gate run; post-run writes into session-state.json.',
  );

  requireWriterBefore(
    'stepCostRecords (append)',
    'SCHEDULER: run wave loop',
    'POST-RUN: finalize metrics, cost, session state, OWASP, auto-PR',
    'Scheduler (via step-executor) appends; post-run reads for cost-attribution.json.',
  );

  requireWriterBefore(
    'qualityGatesTriggered (seed)',
    'seed qualityGatesTriggered flags',
    'REMEDIATION: final gates pipeline',
    'Remediation flips flags based on the initial false state.',
  );

  requireWriterBefore(
    'baselineSnapshot',
    'scan baseline',
    'REMEDIATION: final gates pipeline',
    'Remediation passes baseline to run_quality_gates as the gate baseline.',
  );

  requireWriterBefore(
    'filteredRequirements',
    'filter requirements',
    'REMEDIATION: final gates pipeline',
    'Remediation reads skipped requirement ids to drop gates that do not apply to this goal.',
  );

  requireWriterBefore(
    'costEstimate',
    'cost estimation',
    'SCHEDULER: run wave loop',
    'Scheduler (via step-executor) looks up per-step estimate when recording actual cost.',
  );

  return { ok: violations.length === 0, violations };
}

/**
 * Print a two-column table: stage | module | reads | writes.
 */
function printTable(stages: CallStage[]) {
  const colWidths = [4, 50, 42, 42, 42];

  const pad = (s: string, w: number) => (s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w));
  const header = ['  #', 'stage', 'module', 'reads', 'writes']
    .map((h, i) => pad(h, colWidths[i]))
    .join(' │ ');
  console.log(header);
  console.log(header.replace(/[^│]/g, '─').replace(/│/g, '┼'));

  stages.forEach((s, i) => {
    const swap = s.swapsPlan ? ' [SWAPS plan]' : '';
    const row = [
      pad(String(i + 1).padStart(3), colWidths[0]),
      pad(`${s.label}${swap}`, colWidths[1]),
      pad(s.module, colWidths[2]),
      pad(s.reads.join(', ') || '-', colWidths[3]),
      pad(s.writes.join(', ') || '-', colWidths[4]),
    ].join(' │ ');
    console.log(row);
  });
}

function main() {
  const src = fs.readFileSync(ORCH_PATH, 'utf8');
  const stages = extractCallStages(src);

  console.log('');
  console.log('Phase 3c state mutation audit — executeSwarm call sequence');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  printTable(stages);
  console.log('');

  const { ok, violations } = checkInvariants(stages);

  console.log('Invariant check');
  console.log('───────────────');
  if (ok) {
    console.log('  ✔ all invariants satisfied');
  } else {
    for (const v of violations) console.log(`  ✗ ${v}`);
  }
  console.log('');

  // Also print the plan-swap invariant note (not a stage-ordering check, a within-stage one).
  console.log('Plan-swap invariant (within-scheduler, NOT a stage-ordering check)');
  console.log('──────────────────────────────────────────────────────────────────');
  const replanStage = stages.find(s => s.label.startsWith('REPLAN'));
  const schedStage = stages.find(s => s.label.startsWith('SCHEDULER'));
  if (replanStage && schedStage) {
    if (replanStage.swapsPlan) {
      console.log('  ℹ REPLAN stage may swap context.plan (context.plan = revised).');
    }
    console.log('  ℹ SCHEDULER re-reads context.plan.steps on every loop iteration.');
    console.log('  ℹ Lock-in test: test/wave-scheduler-replan.test.ts');
    console.log('  ℹ This audit does NOT verify the runtime invariant; trace report (3b) does.');
  }
  console.log('');

  if (!ok) {
    process.exit(1);
  }
}

main();
