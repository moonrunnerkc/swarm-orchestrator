import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  extractLiterals,
  isTestFilePath,
  parseUnifiedDiff,
  ParsedDiffFile,
  ParsedDiffLine,
} from './diff-analysis';
import { runVerificationCommand } from './command-runner';
import { createFinding, type Finding, type FindingSeverity } from '../types/finding';
import { normalizeSemgrepResults } from './semgrep-normalizer';
import { type LoadedRule, loadRules } from '../rules/loader';

export type CheatFindingSeverity = FindingSeverity;
export type CheatFinding = Finding;

export interface CheatDetectorInput {
  repoPath: string;
  goalText: string;
  baseRef?: string;
  patchRef?: string;
  diffText?: string;
  allowedTestFiles?: string[];
  semgrepConfigDir?: string;
  runSemgrep?: boolean;
}

export interface CheatDetectorResult {
  score: number;
  findings: CheatFinding[];
  semgrepStatus: 'not-run' | 'passed' | 'failed' | 'unavailable';
}

function gitDiff(input: CheatDetectorInput): string {
  if (input.diffText !== undefined) return input.diffText;
  const args = input.baseRef && input.patchRef
    ? ['diff', '--unified=0', `${input.baseRef}..${input.patchRef}`]
    : ['diff', '--unified=0'];
  return execFileSync('git', args, {
    cwd: input.repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Map orchestrator severity onto Semgrep's severity vocabulary. */
const ORCHESTRATOR_TO_SEMGREP_SEVERITY: Readonly<Record<FindingSeverity, string>> = Object.freeze({
  high: 'ERROR',
  medium: 'WARNING',
  low: 'INFO',
});

/**
 * Convert a loaded cheat rule into the Semgrep rule object shape. Pass-through
 * fields (pattern, pattern-regex, patterns, pattern-either) are preserved
 * verbatim so contributors only need to learn one schema, not two.
 */
function ruleToSemgrep(rule: LoadedRule): Record<string, unknown> {
  const data = rule.data;
  const out: Record<string, unknown> = {
    id: rule.ruleId,
    message: typeof data['message'] === 'string' ? data['message'] : '',
    severity: ORCHESTRATOR_TO_SEMGREP_SEVERITY[data['severity'] as FindingSeverity] ?? 'WARNING',
    languages: Array.isArray(data['languages']) ? data['languages'] : [],
  };
  for (const key of ['pattern', 'pattern-regex', 'patterns', 'pattern-either'] as const) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return out;
}

/**
 * If a per-call override directory was supplied, return that. Otherwise build
 * a transient Semgrep config from cheat rules loaded via the rules loader so
 * Semgrep sees one valid `rules:` array containing every built-in (and any
 * future opted-in community) cheat rule. The transient file lives in os.tmpdir
 * and is rewritten on every call; this keeps the loader as the source of
 * truth and means a new built-in pack drops in without touching this module.
 */
function resolveSemgrepConfigPath(input: CheatDetectorInput): string | undefined {
  if (input.semgrepConfigDir && fs.existsSync(input.semgrepConfigDir)) {
    return input.semgrepConfigDir;
  }
  const loaded = loadRules();
  const cheatRules = loaded.rules.filter((r) => r.kind === 'cheat-rule');
  if (cheatRules.length === 0) return undefined;
  const config = { rules: cheatRules.map(ruleToSemgrep) };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-cheat-rules-'));
  const file = path.join(dir, 'rules.yaml');
  fs.writeFileSync(file, yaml.dump(config), 'utf8');
  return file;
}

function addedLineCount(files: ParsedDiffFile[]): number {
  return files.reduce((sum, file) => (
    sum + file.lines.filter(line => line.kind === 'add' && line.content.trim()).length
  ), 0);
}

function changedImplementationFiles(files: ParsedDiffFile[]): ParsedDiffFile[] {
  return files.filter(file => !isTestFilePath(file.newPath));
}

function changedTestFiles(files: ParsedDiffFile[]): ParsedDiffFile[] {
  return files.filter(file => isTestFilePath(file.newPath));
}

function firstNewLine(lines: ParsedDiffLine[]): number | undefined {
  return lines.find(entry => entry.kind === 'add' && entry.newLine !== undefined)?.newLine
    ?? lines.find(entry => entry.kind === 'context' && entry.newLine !== undefined)?.newLine;
}

function scopedCheatFinding(input: {
  ruleId: string;
  severity: FindingSeverity;
  filePath?: string | undefined;
  line?: number | undefined;
  message: string;
}): CheatFinding {
  if (input.filePath && input.filePath !== 'unknown' && input.line !== undefined) {
    return createFinding({
      scope: 'line',
      producerId: 'cheat-detector',
      ruleId: input.ruleId,
      severity: input.severity,
      filePath: input.filePath,
      line: input.line,
      message: input.message,
    });
  }
  if (input.filePath && input.filePath !== 'unknown') {
    return createFinding({
      scope: 'file',
      producerId: 'cheat-detector',
      ruleId: input.ruleId,
      severity: input.severity,
      filePath: input.filePath,
      message: input.message,
    });
  }
  return createFinding({
    scope: 'summary',
    producerId: 'cheat-detector',
    ruleId: input.ruleId,
    severity: input.severity,
    message: input.message,
  });
}

function detectTestModification(
  files: ParsedDiffFile[],
  allowedTestFiles: string[] | undefined,
): CheatFinding[] {
  const allowed = new Set(allowedTestFiles ?? []);
  return changedTestFiles(files)
    .filter(file => !allowed.has(file.newPath))
    .map(file => scopedCheatFinding({
      ruleId: 'test-modification',
      severity: 'high',
      filePath: file.newPath,
      line: firstNewLine(file.lines),
      message: 'Patch modifies a test file that was not listed in the goal allowlist.',
    }));
}

function detectComplexityMismatch(files: ParsedDiffFile[], goalText: string): CheatFinding[] {
  // Only scan the goal title (first non-empty line). Long-form issue prose
  // contains many commas and conjunctions that do not represent goal steps.
  const title = goalText.split(/\r?\n/).find(line => line.trim() !== '') ?? '';
  const multiStepSignals = (title.match(/\b(?:and|with|including|plus|also|all|multiple)\b|[,;]/gi) ?? []).length;
  if (multiStepSignals < 3 || addedLineCount(files) >= 5) return [];
  return [scopedCheatFinding({
    ruleId: 'complexity-mismatch',
    severity: 'low',
    filePath: changedImplementationFiles(files)[0]?.newPath ?? 'unknown',
    message: 'Goal describes multiple behaviors but the patch adds fewer than five substantive lines.',
  })];
}

function detectMockMutation(files: ParsedDiffFile[]): CheatFinding[] {
  const implementationChanged = changedImplementationFiles(files).length > 0;
  if (implementationChanged) return [];

  const mockRe = /\b(mock(?:ReturnValue|ResolvedValue|Implementation)?|fixture|beforeEach|setUp|setup)\b/i;
  const findings: CheatFinding[] = [];
  for (const file of changedTestFiles(files)) {
    const line = file.lines.find(entry =>
      (entry.kind === 'add' || entry.kind === 'remove') && mockRe.test(entry.content)
    );
    if (line) {
      findings.push({
        ...scopedCheatFinding({
          ruleId: 'mock-mutation',
          severity: 'high',
          filePath: file.newPath,
          line: line.newLine,
          message: 'Patch changes mock or fixture setup without changing implementation code.',
        }),
      });
    }
  }
  return findings;
}

function detectExceptionSwallowing(files: ParsedDiffFile[]): CheatFinding[] {
  const findings: CheatFinding[] = [];
  for (const file of changedImplementationFiles(files)) {
    const added = file.lines.filter(line => line.kind === 'add');
    for (let i = 0; i < added.length; i += 1) {
      const line = added[i];
      const next = added.slice(i + 1, i + 4).map(entry => entry.content.trim());
      const body = next.join(' ');
      if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}?/.test(line.content)
        && (/\bcatch[^{]*\{\s*\}\s*$/.test(line.content)
          || /^(?:\}|console\.|logger\.)/.test(body))) {
        findings.push({
          ...scopedCheatFinding({
            ruleId: 'exception-swallowing',
            severity: 'high',
            filePath: file.newPath,
            line: line.newLine,
            message: 'Patch adds a catch handler that appears empty or log-only.',
          }),
        });
      }
    }
  }
  return findings;
}

function expectedLiteralsFromTests(files: ParsedDiffFile[]): Set<string> {
  const literals = new Set<string>();
  for (const file of changedTestFiles(files)) {
    for (const line of file.lines) {
      if (line.kind === 'add' && /\b(assert|expect|toEqual|strictEqual|deepStrictEqual)\b/.test(line.content)) {
        for (const literal of extractLiterals(line.content)) literals.add(literal);
      }
    }
  }
  return literals;
}

function detectHardcodedAnswers(files: ParsedDiffFile[]): CheatFinding[] {
  const expected = expectedLiteralsFromTests(files);
  if (expected.size === 0) return [];
  const findings: CheatFinding[] = [];
  for (const file of changedImplementationFiles(files)) {
    for (const line of file.lines.filter(entry => entry.kind === 'add')) {
      const overlap = extractLiterals(line.content).find(literal => expected.has(literal));
      if (overlap) {
        findings.push({
          ...scopedCheatFinding({
            ruleId: 'hardcoded-answer',
            severity: 'medium',
            filePath: file.newPath,
            line: line.newLine,
            message: `Implementation adds literal "${overlap}" that also appears in test expectations.`,
          }),
        });
      }
    }
  }
  return findings;
}

function scoreFindings(findings: CheatFinding[]): number {
  const penalty = findings.reduce((sum, finding) => {
    if (finding.severity === 'high') return sum + 0.35;
    if (finding.severity === 'medium') return sum + 0.2;
    return sum + 0.1;
  }, 0);
  return Math.max(0, Number((1 - penalty).toFixed(3)));
}

async function runSemgrep(input: CheatDetectorInput, files: ParsedDiffFile[]): Promise<{
  status: CheatDetectorResult['semgrepStatus'];
  findings: CheatFinding[];
}> {
  if (input.runSemgrep === false) return { status: 'not-run', findings: [] };
  const configPath = resolveSemgrepConfigPath(input);
  if (!configPath) return { status: 'unavailable', findings: [] };
  const fileArgs = files.map(file => `'${file.newPath.replace(/'/g, `'\\''`)}'`).join(' ');
  if (!fileArgs) return { status: 'not-run', findings: [] };

  const command = `semgrep --config '${configPath.replace(/'/g, `'\\''`)}' --json ${fileArgs}`;
  const result = await runVerificationCommand(command, input.repoPath, 120_000);
  if (result.exitCode !== 0 && !result.stdout.trim()) return { status: 'failed', findings: [] };

  try {
    return { status: 'passed', findings: normalizeSemgrepResults(result.stdout, input.repoPath) };
  } catch {
    return { status: 'failed', findings: [] };
  }
}

/**
 * Detect common ways agent patches game verification instead of fixing code.
 *
 * @param input - Repo, goal text, diff source, and Semgrep settings.
 * @returns Per-rule findings and advisory score.
 */
export async function runCheatDetector(input: CheatDetectorInput): Promise<CheatDetectorResult> {
  const diff = gitDiff(input);
  const files = parseUnifiedDiff(diff);
  const diffFindings = [
    ...detectHardcodedAnswers(files),
    ...detectExceptionSwallowing(files),
    ...detectTestModification(files, input.allowedTestFiles),
    ...detectComplexityMismatch(files, input.goalText),
    ...detectMockMutation(files),
  ];
  const semgrep = await runSemgrep(input, files);
  const findings = [...diffFindings, ...semgrep.findings];
  return {
    score: scoreFindings(findings),
    findings,
    semgrepStatus: semgrep.status,
  };
}
