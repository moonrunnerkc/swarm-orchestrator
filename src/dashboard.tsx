import React, { useEffect, useState } from 'react';
import { QueueStats } from './execution-queue';
import { MetricsComparison } from './metrics-types';
import { OrchestratorState, SteeringCommand, formatSteeringCommand, parseSteeringCommand } from './steering-types';
import { ParallelStepResult } from './swarm-orchestrator';

// Ink 4+ is ESM-only and yoga-wasm-web uses top-level await,
// which breaks CJS require(). Lazy-load at render time via dynamic import().
let Box: any, Text: any, inkRender: any, useInput: any;
let Spinner: any;

interface DashboardProps {
  executionId: string;
  goal: string;
  totalSteps: number;
  currentWave: number;
  totalWaves: number;
  results: ParallelStepResult[];
  repoGroups?: { repo: string; stepCount: number; completed: number }[];
  recentCommits: Array<{ message: string; sha?: string; agent?: string }>;
  prLinks: string[];
  startTime: string;
  orchestratorState?: OrchestratorState;
  onCommand?: (command: SteeringCommand) => void;
  readOnly?: boolean;
  metricsComparison?: MetricsComparison | null;
  queueStats?: QueueStats;
  criticResults?: { score: number; flags: string[]; recommendation: string }[];
  leanSavedRequests?: number;
  costSummary?: string;
  agentLog?: string[];
  maxRows?: number;
}

interface StatusIconProps {
  status: ParallelStepResult['status'];
}

const StatusIcon: React.FC<StatusIconProps> = ({ status }) => {
  switch (status) {
    case 'pending':
      return <Text color="gray">⏸</Text>;
    case 'running':
      return <Text color="blue"><Spinner type="dots" /></Text>;
    case 'completed':
      return <Text color="green">✅</Text>;
    case 'failed':
      return <Text color="red">❌</Text>;
    case 'blocked':
      return <Text color="yellow">🚧</Text>;
    default:
      return <Text color="gray">◻</Text>;
  }
};

interface ProgressBarProps {
  completed: number;
  total: number;
  width?: number;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ completed, total, width = 40 }) => {
  const safeTotal = Math.max(total, 1);
  const clampedCompleted = Math.min(completed, safeTotal);
  const percentage = Math.round((clampedCompleted / safeTotal) * 100);
  const filledWidth = Math.round((clampedCompleted / safeTotal) * width);
  const emptyWidth = Math.max(0, width - filledWidth);

  return (
    <Box>
      <Text color="cyan">
        {'█'.repeat(filledWidth)}
        <Text color="gray">{'░'.repeat(emptyWidth)}</Text>
        {' '}
        {percentage}%
      </Text>
    </Box>
  );
};

interface ProductivitySummaryProps {
  comparison: MetricsComparison;
}

const ProductivitySummary: React.FC<ProductivitySummaryProps> = ({ comparison }) => {
  const { current, averageHistorical, delta } = comparison;

  const formatTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const getChangeIndicator = (value: number, lowerIsBetter: boolean = false): { text: string; color: string } => {
    if (Math.abs(value) < 0.01) return { text: '━', color: 'gray' };

    const isGood = lowerIsBetter ? value < 0 : value > 0;
    const symbol = value > 0 ? '▲' : '▼';
    const color = isGood ? 'green' : 'yellow';

    return { text: symbol, color };
  };

  const timeIndicator = getChangeIndicator(delta.timePercent, true);
  const passRateIndicator = getChangeIndicator(delta.passRateDiff, false);

  return (
    <Box flexDirection="column" marginBottom={1} borderStyle="double" borderColor="cyan" paddingX={1}>
      <Text bold underline color="cyan">
        📊 Productivity Summary
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text bold>Time: </Text>
          {formatTime(current.totalTimeMs)}
          {' '}
          <Text color={timeIndicator.color}>
            {timeIndicator.text} {Math.abs(delta.timePercent).toFixed(1)}%
          </Text>
          <Text color="gray"> vs avg {formatTime(averageHistorical.totalTimeMs)}</Text>
        </Text>

        <Text>
          <Text bold>Commits: </Text>
          {current.commitCount}
          {' '}
          {delta.commitCountDiff !== 0 && (
            <Text color={delta.commitCountDiff > 0 ? 'green' : 'yellow'}>
              ({delta.commitCountDiff > 0 ? '+' : ''}{delta.commitCountDiff.toFixed(0)})
            </Text>
          )}
          <Text color="gray"> vs avg {averageHistorical.commitCount.toFixed(1)}</Text>
        </Text>

        <Text>
          <Text bold>Verification: </Text>
          {current.verificationsPassed}/{current.verificationsPassed + current.verificationsFailed}
          {' '}
          ({(current.verificationsPassed / (current.verificationsPassed + current.verificationsFailed) * 100).toFixed(0)}%)
          {' '}
          <Text color={passRateIndicator.color}>
            {passRateIndicator.text} {Math.abs(delta.passRateDiff * 100).toFixed(1)}%
          </Text>
        </Text>

        {current.recoveryEvents.length > 0 && (
          <Text color="yellow">
            <Text bold>Recoveries: </Text>
            {current.recoveryEvents.length}
          </Text>
        )}
      </Box>
    </Box>
  );
};

const SwarmDashboard: React.FC<DashboardProps> = ({
  executionId: _executionId,
  goal,
  totalSteps,
  currentWave,
  totalWaves,
  results,
  recentCommits,
  prLinks,
  startTime,
  orchestratorState,
  onCommand,
  readOnly = false,
  metricsComparison,
  queueStats: _queueStats,
  repoGroups,
  criticResults,
  leanSavedRequests,
  costSummary,
  agentLog,
  maxRows = 24
}) => {
  const [elapsedTime, setElapsedTime] = useState('0s');
  const [input, setInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [showInput] = useState(!readOnly);

  // Compact mode: hide verbose sections when terminal is small.
  // Fixed overhead: header(1) + info(3) + progress(3) + status-box(3) + step-header(1)
  //   + footer(1) + margins(~4) = ~16 lines before step rows.
  // Each step row = 1 line.  Keep at least 2 visible.
  const compact = maxRows < (16 + results.length + 6);

  // Handle keyboard input
  useInput((inputChar: string, key: any) => {
    if (readOnly) return;

    if (key.return) {
      // Submit command
      if (input.trim()) {
        const command = parseSteeringCommand(input);
        if (command && onCommand) {
          onCommand(command);
          setCommandHistory(prev => [...prev, formatSteeringCommand(command)].slice(-5));
        } else {
          setCommandHistory(prev => [...prev, `Invalid: ${input}`].slice(-5));
        }
        setInput('');
      }
    } else if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1));
    } else if (key.escape) {
      setInput('');
    } else if (inputChar && !key.ctrl && !key.meta) {
      setInput(prev => prev + inputChar);
    }
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      setElapsedTime(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  const completedSteps = results.filter(r => r.status === 'completed').length;
  const failedSteps = results.filter(r => r.status === 'failed').length;
  const runningSteps = results.filter(r => r.status === 'running').length;
  const blockedSteps = results.filter(r => r.status === 'pending' && runningSteps === 0 && failedSteps > 0).length;
  // Progress denominator: steps that ran or will run (exclude permanently blocked steps)
  const effectiveTotal = totalSteps - blockedSteps;

  // How many agent-log lines we can afford after fixed chrome + step rows.
  // Fixed lines: header(1) + goal(1) + progress(3) + step-header(1) + footer(1) + margins(~5) = ~12
  const fixedLines = 12;
  const agentLogBudget = compact ? 0 : Math.max(0, maxRows - fixedLines - results.length - 5);
  const agentLogLines = Math.min(agentLogBudget, 6);
  const needsConflictInput = orchestratorState && orchestratorState.pendingConflicts.length > 0;
  const isFinished = runningSteps === 0 && completedSteps + failedSteps + blockedSteps === totalSteps;

  return (
    <Box flexDirection="column" paddingX={1} height={maxRows} overflow="hidden">
      {/* Header — single truncated line (prevents terminal wrapping ⇒ Ink cursor-up mismatch) */}
      <Text wrap="truncate-end">
        <Text bold color="magenta">🐝 Swarm Orchestrator</Text>
        <Text color="gray"> | </Text>
        <Text color="yellow">{elapsedTime}</Text>
        <Text color="gray"> | Wave {currentWave}/{totalWaves}</Text>
        {costSummary && <Text color="gray"> | 💰 {costSummary}</Text>}
      </Text>

      {/* Goal — truncated to single line */}
      <Text wrap="truncate-end">
        <Text bold>Goal: </Text>
        <Text color="cyan">{goal}</Text>
      </Text>

      {/* Progress bar + counts */}
      <Box flexDirection="column" marginTop={1}>
        <ProgressBar completed={completedSteps + failedSteps} total={effectiveTotal} />
        <Text color="gray">
          {completedSteps} passed{failedSteps > 0 ? <Text color="red"> | {failedSteps} failed</Text> : ''}{blockedSteps > 0 ? <Text color="yellow"> | {blockedSteps} blocked</Text> : ''} / {totalSteps} total
          {'  '}<Text color="blue">{runningSteps} running</Text>
          {'  '}<Text color="gray">{results.filter(r => r.status === 'pending').length} pending</Text>
        </Text>
      </Box>

      {/* Repo-Level Status (multi-repo orchestration) — only in non-compact */}
      {!compact && repoGroups && repoGroups.length > 1 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Repositories:</Text>
          {repoGroups.map((rg, idx) => (
            <Box key={idx}>
              <Box width={30}><Text color="cyan">{rg.repo}</Text></Box>
              <Box width={12}><Text>{rg.completed}/{rg.stepCount} steps</Text></Box>
              <Box width={8}><Text color="green">{rg.stepCount > 0 ? Math.round(rg.completed / rg.stepCount * 100) : 0}%</Text></Box>
            </Box>
          ))}
        </Box>
      )}

      {/* Step Status Table */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold underline>Agent Status:</Text>
        {results.map(result => (
          <Box key={result.stepNumber}>
            <Box width={3}><StatusIcon status={result.status} /></Box>
            <Box width={8}><Text color="gray">Step {result.stepNumber}</Text></Box>
            <Box width={22}>
              <Text color={result.status === 'completed' ? 'green' : 'white'}>
                {result.agentName}
              </Text>
            </Box>
            <Box width={12}><Text color="gray">{result.status}</Text></Box>
            {result.error ? (
              <Box flexGrow={1}><Text color="red" wrap="truncate-end">({result.error})</Text></Box>
            ) : result.verificationResult && !result.verificationResult.passed ? (
              <Box><Text color="yellow">(verification failed)</Text></Box>
            ) : null}
          </Box>
        ))}
      </Box>

      {/* Live Agent Output — only when there's vertical budget */}
      {agentLogLines > 0 && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text bold color="cyan">Agent Log:</Text>
          {agentLog && agentLog.length > 0 ? (
            agentLog.slice(-agentLogLines).map((line, idx) => (
              <Text key={idx} color="gray" wrap="truncate-end">{line}</Text>
            ))
          ) : (
            <Text color="gray" dimColor>Waiting for agent output…</Text>
          )}
        </Box>
      )}

      {/* Critic Scores — only in non-compact */}
      {!compact && criticResults && criticResults.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Critic Review:</Text>
          {criticResults.map((cr, idx) => (
            <Box key={idx}>
              <Text color={cr.score >= 80 ? 'green' : cr.score >= 60 ? 'yellow' : 'red'}>
                Wave {idx + 1}: {cr.score}/100 ({cr.recommendation}) {cr.flags.length > 0 ? `- ${cr.flags.length} flag(s)` : ''}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Recent Commits — only in non-compact and when finished */}
      {!compact && isFinished && recentCommits.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Recent Commits:</Text>
          {recentCommits.slice(0, 3).map((commit, idx) => (
            <Box key={idx}>
              <Text color="gray">{commit.sha?.substring(0, 7) || 'xxxxxxx'} </Text>
              <Text color="white">{commit.message}</Text>
              {commit.agent && <Text color="cyan"> ({commit.agent})</Text>}
            </Box>
          ))}
        </Box>
      )}

      {/* PR Links — only in non-compact */}
      {!compact && prLinks.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Pull Requests:</Text>
          {prLinks.map((link, idx) => (
            <Box key={idx}><Text color="blue">{link}</Text></Box>
          ))}
        </Box>
      )}

      {/* Pending Conflicts */}
      {orchestratorState && orchestratorState.pendingConflicts.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline color="yellow">
            ⚠️ Conflicts ({orchestratorState.pendingConflicts.length}):
          </Text>
          {orchestratorState.pendingConflicts.slice(0, 3).map((conflict, idx) => (
            <Box key={conflict.id} marginLeft={2}>
              <Text color="yellow">
                {idx + 1}. Step {conflict.stepNumber} ({conflict.agentName}): {conflict.type}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Command input — only when conflicts need resolving or orchestrator paused */}
      {showInput && !readOnly && (needsConflictInput || orchestratorState?.status === 'paused') && (
        <Box marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text color="cyan">Command: </Text>
          <Text>{input}</Text>
          <Text color="gray" dimColor>▊</Text>
        </Box>
      )}

      {/* Steering History */}
      {!readOnly && commandHistory.length > 0 && (
        <Box flexDirection="column">
          {commandHistory.slice(-2).map((cmd, idx) => (
            <Box key={idx}><Text color="gray">» {cmd}</Text></Box>
          ))}
        </Box>
      )}

      {/* Metrics Comparison — only in non-compact and when finished */}
      {!compact && metricsComparison && isFinished && (
        <ProductivitySummary comparison={metricsComparison} />
      )}

      {/* Lean Mode Savings */}
      {leanSavedRequests != null && leanSavedRequests > 0 && (
        <Box>
          <Text color="green" bold>Saved: {leanSavedRequests} request(s), ~${(leanSavedRequests * 0.03).toFixed(2)}</Text>
        </Box>
      )}

      {/* Spacer — fills remaining height, keeps frame size constant */}
      <Box flexGrow={1} />

      {/* Footer */}
      <Box>
        {readOnly ? (
          <Text bold color="blue">👁️  Read-only mode</Text>
        ) : orchestratorState?.status === 'paused' ? (
          <Text bold color="yellow">⏸️  Paused - Type 'resume' to continue</Text>
        ) : isFinished && failedSteps === 0 ? (
          <Text bold color="green">All {completedSteps} steps verified.</Text>
        ) : isFinished && failedSteps > 0 ? (
          <Text bold color="yellow">Run complete — see summary below.</Text>
        ) : (
          <Text color="gray">Ctrl+C to exit</Text>
        )}
      </Box>
    </Box>
  );
};

export interface DashboardManager {
  update: (updates: Partial<DashboardProps>) => void;
  stop: () => void;
  setCommandHandler: (handler: (command: SteeringCommand) => void) => void;
}

/**
 * Start the live dashboard. Falls back gracefully in non-TTY environments.
 *
 * ## Why we patch stdout.write
 *
 * Ink re-renders by emitting  \x1b[<N>A  (cursor-up N lines) followed by
 * the new frame.  N = number of '\n' characters in the *previous* output.
 * When any rendered line is wider than `process.stdout.columns` the
 * terminal soft-wraps it into two (or more) visual rows.  Ink has no
 * knowledge of these extra rows, so N is too small, the cursor doesn't
 * reach the top of the old frame, and the new frame is pasted *below*
 * the remnant → the "stacked duplicate header" bug.
 *
 * Fix: we monkey-patch `process.stdout.write` while the dashboard is
 * alive.  Every chunk that contains a cursor-up escape (only Ink emits
 * these) is rewritten:
 *
 *   \x1b[H        – cursor to absolute row 1, col 1  (home)
 *   <frame body>  – new frame  (with \x1b[K before every \n to wipe
 *                   any trailing remnants of previously longer lines)
 *   \x1b[0J       – erase from cursor to end of screen
 *
 * The frame always paints from the top-left corner of the viewport,
 * making it immune to width-miscounting, emoji-width bugs, and any
 * other source of line-count drift.
 */
export async function startDashboard(
  initialProps: DashboardProps,
  commandHandler?: (command: SteeringCommand) => void
): Promise<DashboardManager | null> {
  // Guard: Ink requires a TTY with raw mode support. Bail out early in CI / piped output.
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return null;
  }

  // Use native import() that TypeScript won't transform to require().
  // CJS require() can't load ESM-only ink (yoga-wasm-web uses top-level await).
  const nativeImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;
  const ink = await nativeImport('ink');
  const inkSpinner = await nativeImport('ink-spinner');
  Box = ink.Box;
  Text = ink.Text;
  inkRender = ink.render;
  useInput = ink.useInput;
  Spinner = inkSpinner.default;

  let currentProps = { ...initialProps };
  let currentCommandHandler = commandHandler;
  let stopped = false;

  const getMaxRows = () => Math.max((process.stdout.rows || 24) - 2, 12);

  const getProps = () => ({
    ...currentProps,
    maxRows: getMaxRows(),
    ...(currentCommandHandler ? { onCommand: currentCommandHandler } : {})
  });

  // ── stdout.write interception ──────────────────────────────────────────
  // Ink splits a single frame across multiple synchronous stdout.write()
  // calls: typically [cursor-up escape] → [body] → [erase-below escape].
  // An interceptor that reacts to each chunk independently either leaks
  // body chunks (stacked frames — seen on ≥80-col terminals when any
  // rendered line soft-wraps) or nukes frames when an escape-only chunk
  // fires a clear-screen.
  //
  // Fix: buffer every write within a single event-loop tick, then flush
  // the concatenated string as one frame paint — cursor home, per-line
  // clear, body, erase-below. The whole frame lives or dies together.
  //
  // Safe because: while the dashboard is active, no other code should be
  // writing to stdout — the logger routes non-error output to stderr via
  // the isDashboardActive() guard.
  const _origWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
  // All cursor-move and erase escapes that Ink / log-update might emit.
  // We strip them all and replace with our own home + per-line clear.
  const _cursorMoveRe = /\x1b\[\d*[ABFG]|\x1b\[\d*;\d*[Hf]|\x1b\[[0-9]*[JK]/g;

  let frameBuf = '';
  let frameScheduled = false;

  const flushFrame = () => {
    frameScheduled = false;
    const buf = frameBuf;
    frameBuf = '';
    if (!buf) return;
    // 1. Strip every cursor-move / erase Ink emitted; we do our own.
    // 2. Drop trailing newlines — a '\n' at the last viewport row scrolls
    //    the terminal, pushing earlier content into scrollback where
    //    subsequent \x1b[H home positions can't reach it.
    // 3. Per-line \x1b[K so each row fully overwrites the previous frame.
    const stripped = buf.replace(_cursorMoveRe, '');
    if (!stripped) return; // nothing to paint (pure cursor/erase chunk)
    const trimmed = stripped.replace(/\n+$/, '');
    const padded = trimmed.replace(/\n/g, '\x1b[K\n');
    _origWrite('\x1b[H' + padded + '\x1b[K\x1b[0J');
  };

  (process.stdout as any).write = function (
    chunk: any,
    _encodingOrCb?: any,
    cb?: any,
  ): boolean {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    frameBuf += str;
    if (!frameScheduled) {
      frameScheduled = true;
      setImmediate(flushFrame);
    }
    if (typeof cb === 'function') setImmediate(cb);
    else if (typeof _encodingOrCb === 'function') setImmediate(_encodingOrCb);
    return true;
  };

  // Prepare screen: clear viewport, position at top-left, hide text cursor
  _origWrite('\x1b[2J\x1b[H\x1b[?25l');

  const { rerender, unmount } = inkRender(
    <SwarmDashboard {...getProps()} />,
    { patchConsole: false }
  );

  // Batch rapid-fire update() calls into a single rerender per event-loop tick.
  let dirty = false;

  return {
    update: (updates: Partial<DashboardProps>) => {
      if (stopped) return;
      currentProps = { ...currentProps, ...updates };
      if (!dirty) {
        dirty = true;
        setImmediate(() => {
          dirty = false;
          if (!stopped) rerender(<SwarmDashboard {...getProps()} />);
        });
      }
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      unmount();
      // Flush any pending frame buffered by our interceptor, then restore
      // the original stdout.write, show the cursor, and drop below the
      // last frame so post-dashboard logs don't overwrite it.
      flushFrame();
      (process.stdout as any).write = _origWrite;
      _origWrite('\x1b[?25h\n');
    },
    setCommandHandler: (handler: (command: SteeringCommand) => void) => {
      if (stopped) return;
      currentCommandHandler = handler;
      if (!dirty) {
        dirty = true;
        setImmediate(() => {
          dirty = false;
          if (!stopped) rerender(<SwarmDashboard {...getProps()} />);
        });
      }
    }
  };
}

export default SwarmDashboard;
