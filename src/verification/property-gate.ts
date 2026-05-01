import * as fs from 'fs';
import * as path from 'path';
import { runVerificationCommand, VerificationCommandResult } from './command-runner';
import { createFinding, type Finding } from '../types/finding';
import { parsePythonParams, parseTSParams } from './property-param-parsing';
import { buildPropertyCommand } from './property-harness';
import {
  pythonTypeToStrategy,
  tsTypeToArbitrary,
  type PropertyParameter,
} from './property-strategies';

export type PropertyGateStatus = 'PASS' | 'ADVISORY' | 'SKIP';
export type PropertyLanguage = 'typescript' | 'javascript' | 'python';

export interface PropertyTarget {
  language: PropertyLanguage;
  filePath: string;
  line: number;
  functionName: string;
  typed: boolean;
  advisoryOnly: boolean;
  /**
   * Source-order parameters with derived strategies. Each entry's `strategy`
   * is undefined when the parameter is untyped or has an unsupported type;
   * `unsupportedReason` describes why the gate had to skip the function in
   * that case.
   */
  parameters: PropertyParameter[];
  /**
   * When set, the gate skipped this target rather than running a harness
   * against it. Surfaced verbatim into a low-severity advisory finding so
   * the run report explains the skip.
   */
  unsupportedReason?: string;
}

export type PropertyFinding = Finding;

export interface PropertyGateInput {
  targetRepoPath: string;
  changedFiles: string[];
  timeoutMsPerFunction?: number;
  commandRunner?: PropertyCommandRunner;
}

export interface PropertyGateResult {
  status: PropertyGateStatus;
  score: number;
  targets: PropertyTarget[];
  findings: PropertyFinding[];
}

export type PropertyCommandRunner = (
  command: string,
  cwd: string,
  timeoutMs: number,
) => Promise<VerificationCommandResult>;

function isSupportedFile(filePath: string): boolean {
  return /\.(?:ts|tsx|js|jsx|py)$/.test(filePath) && !filePath.endsWith('.d.ts');
}

function isTypedTypeScriptSignature(params: string, suffix: string): boolean {
  return /:\s*[\w.[\]<>|]+/.test(params) || /^\s*:\s*[\w.[\]<>|]+/.test(suffix);
}

function isTypedPythonSignature(params: string, suffix: string): boolean {
  return /:\s*[\w.[\]<>|]+/.test(params) || /->\s*[\w.[\]<>|]+/.test(suffix);
}

function declarationLine(source: string, matchIndex: number, matchedText: string): number {
  const offset = matchedText.startsWith('\n') ? 1 : 0;
  const declarationIndex = matchIndex + offset;
  let line = 1;
  for (let i = 0; i < declarationIndex; i += 1) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

/**
 * Resolve strategies for a parameter list. Returns the parameters with
 * `strategy` populated where possible, plus an `unsupportedReason` when
 * the gate cannot run a harness against this target.
 *
 * The reason is "no type hints" for an untyped target and "type X is not
 * supported" for the first unmappable type. We surface only the first
 * unmappable type so the advisory message stays inside the 200-char
 * finding-message budget.
 */
function resolveStrategies(
  parameters: PropertyParameter[],
  mapper: (rawType: string) => string | undefined,
): { resolved: PropertyParameter[]; unsupportedReason?: string } {
  if (parameters.length === 0) {
    return { resolved: [], unsupportedReason: 'function has no parameters; nothing to fuzz' };
  }
  const untyped = parameters.find((p) => p.rawType === '');
  if (untyped) {
    return {
      resolved: parameters,
      unsupportedReason: `parameter '${untyped.name}' has no type hint; cannot generate inputs`,
    };
  }
  const resolved: PropertyParameter[] = [];
  for (const p of parameters) {
    const strategy = mapper(p.rawType);
    if (!strategy) {
      return {
        resolved: parameters,
        unsupportedReason: `parameter '${p.name}' has unsupported type '${p.rawType}'; cannot generate inputs`,
      };
    }
    resolved.push({ name: p.name, rawType: p.rawType, strategy });
  }
  return { resolved };
}

function buildPythonTarget(
  filePath: string,
  source: string,
  match: RegExpMatchArray,
): PropertyTarget {
  const params = match[2] ?? '';
  const suffix = match[3] ?? '';
  const typed = isTypedPythonSignature(params, suffix);
  const parsed = parsePythonParams(params);
  const { resolved, unsupportedReason } = resolveStrategies(parsed, pythonTypeToStrategy);
  const target: PropertyTarget = {
    language: 'python',
    filePath,
    line: declarationLine(source, match.index ?? 0, match[0]),
    functionName: match[1] ?? 'unknown',
    typed,
    advisoryOnly: !typed,
    parameters: resolved,
  };
  if (unsupportedReason) target.unsupportedReason = unsupportedReason;
  return target;
}

function buildTSTarget(
  filePath: string,
  source: string,
  match: RegExpMatchArray,
  language: PropertyLanguage,
): PropertyTarget {
  const params = match[2] ?? '';
  const suffix = match[3] ?? '';
  const typed = language === 'typescript' ? isTypedTypeScriptSignature(params, suffix) : false;
  const parsed = parseTSParams(params);
  const { resolved, unsupportedReason } = language === 'typescript'
    ? resolveStrategies(parsed, tsTypeToArbitrary)
    : { resolved: parsed, unsupportedReason: 'untyped JavaScript; using generic fuzzing' };
  const target: PropertyTarget = {
    language,
    filePath,
    line: declarationLine(source, match.index ?? 0, match[0]),
    functionName: match[1] ?? 'unknown',
    typed,
    advisoryOnly: language === 'javascript' || !typed,
    parameters: resolved,
  };
  if (unsupportedReason) target.unsupportedReason = unsupportedReason;
  return target;
}

function discoverInSource(filePath: string, source: string): PropertyTarget[] {
  const ext = path.extname(filePath);
  const targets: PropertyTarget[] = [];
  if (ext === '.py') {
    for (const match of source.matchAll(/(?:^|\n)def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*([^:]*):/g)) {
      targets.push(buildPythonTarget(filePath, source, match));
    }
    return targets;
  }
  const language: PropertyLanguage = ext === '.ts' || ext === '.tsx' ? 'typescript' : 'javascript';
  const patterns = [
    /(?:export\s+)?function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*([^ {=>]*)/g,
    /(?:export\s+)?const\s+([A-Za-z_]\w*)\s*=\s*\(([^)]*)\)\s*([^=]*)=>/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      targets.push(buildTSTarget(filePath, source, match, language));
    }
  }
  return targets;
}

/**
 * Discover modified functions that can receive generated property tests.
 *
 * @param repoPath - Target repository root.
 * @param changedFiles - Repo-relative changed file paths.
 * @returns Function targets with type-system coverage metadata, including
 *          parsed parameter types and resolved strategies (or an
 *          unsupportedReason when the function cannot be fuzzed).
 */
export function discoverPropertyTargets(repoPath: string, changedFiles: string[]): PropertyTarget[] {
  const targets: PropertyTarget[] = [];
  for (const rel of changedFiles.filter(isSupportedFile)) {
    if (rel.startsWith('/') || path.normalize(rel).startsWith('..')) continue;
    const full = path.join(repoPath, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    targets.push(...discoverInSource(rel, fs.readFileSync(full, 'utf8')));
  }
  return targets;
}

function extractCounterexample(output: string): string | undefined {
  const match = output.match(/Counterexample:\s*([^\n]+)/i);
  return match?.[1]?.trim();
}

function propertyFinding(target: PropertyTarget, counterexample: string | undefined): PropertyFinding {
  const suffix = counterexample ? `: ${counterexample}` : '';
  const rawMessage = target.advisoryOnly
    ? `Generic advisory fuzzing found a failure in ${target.functionName}${suffix}.`
    : `Property-based test found a counterexample in ${target.functionName}${suffix}.`;
  const message = rawMessage.length <= 200 ? rawMessage : `${rawMessage.slice(0, 197)}...`;
  return createFinding({
    scope: 'line',
    producerId: 'property-gate',
    ruleId: target.advisoryOnly ? 'generic-property-fuzzing' : 'property-counterexample',
    severity: target.advisoryOnly ? 'low' : 'medium',
    filePath: target.filePath,
    line: target.line,
    message,
  });
}

function unsupportedFinding(target: PropertyTarget): PropertyFinding {
  const reason = target.unsupportedReason ?? 'unknown';
  const rawMessage = `Property gate skipped ${target.functionName}: ${reason}.`;
  const message = rawMessage.length <= 200 ? rawMessage : `${rawMessage.slice(0, 197)}...`;
  return createFinding({
    scope: 'line',
    producerId: 'property-gate',
    ruleId: 'property-skip-unsupported',
    severity: 'low',
    filePath: target.filePath,
    line: target.line,
    message,
  });
}

/**
 * Run generated property-based tests for modified functions.
 *
 * Each typed function gets a Hypothesis (Python) or fast-check (TS)
 * harness whose generators are derived from the function's parameter
 * type hints. Functions whose signatures contain unsupported types are
 * skipped with a low-severity advisory naming the offending type, so
 * downstream readers can tell tooling skips apart from real
 * counterexamples. Untyped JavaScript falls back to generic fuzzing.
 *
 * @param input - Target repo, changed files, timeout, and optional runner.
 * @returns Advisory property-testing result.
 */
export async function runPropertyGate(input: PropertyGateInput): Promise<PropertyGateResult> {
  const targets = discoverPropertyTargets(input.targetRepoPath, input.changedFiles);
  if (targets.length === 0) {
    return { status: 'SKIP', score: 1, targets: [], findings: [] };
  }

  const runner = input.commandRunner ?? runVerificationCommand;
  const findings: PropertyFinding[] = [];
  for (const target of targets) {
    if (target.unsupportedReason && target.language !== 'javascript') {
      findings.push(unsupportedFinding(target));
      continue;
    }
    const command = buildPropertyCommand(input.targetRepoPath, target);
    const result = await runner(command, input.targetRepoPath, input.timeoutMsPerFunction ?? 60_000);
    if (result.exitCode !== 0) {
      const output = `${result.stdout}\n${result.stderr}`;
      const counterexample = extractCounterexample(output);
      findings.push(propertyFinding(target, counterexample));
    }
  }

  // Skip findings are advisory-only and do not count against the score.
  const failureCount = findings.filter((f) => f.ruleId !== 'property-skip-unsupported').length;
  const status: PropertyGateStatus = findings.length > 0 ? 'ADVISORY' : 'PASS';
  return {
    status,
    score: Math.max(0, Number((1 - failureCount * 0.25).toFixed(3))),
    targets,
    findings,
  };
}
