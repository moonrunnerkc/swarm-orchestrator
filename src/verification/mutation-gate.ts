import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { runVerificationCommand, VerificationCommandResult } from './command-runner';

export type MutationLanguage = 'javascript-typescript' | 'python' | 'java';
export type MutationGateStatus = 'PASS' | 'WARNING' | 'FAIL' | 'SKIP';

export interface MutationThresholds {
  failBelow: number;
  warnBelow: number;
}

export interface MutationLanguageTarget {
  language: MutationLanguage;
  files: string[];
}

export interface MutationToolResult {
  language: MutationLanguage;
  files: string[];
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  totalMutants: number;
  killedMutants: number;
  survivedMutants: number;
  mutationScore: number;
}

export interface MutationGateInput {
  targetRepoPath: string;
  changedFiles: string[];
  timeoutMs?: number;
  thresholds?: MutationThresholds;
  commandRunner?: MutationCommandRunner;
}

export interface MutationGateResult {
  status: MutationGateStatus;
  reason: string;
  mutationScore: number;
  thresholds: MutationThresholds;
  totalMutants: number;
  killedMutants: number;
  survivedMutants: number;
  results: MutationToolResult[];
}

export type MutationCommandRunner = (
  command: string,
  cwd: string,
  timeoutMs: number,
) => Promise<VerificationCommandResult>;

export const DEFAULT_MUTATION_THRESHOLDS: MutationThresholds = {
  failBelow: 0.6,
  warnBelow: 0.8,
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Load mutation thresholds from `.swarm/gates.yaml`, falling back to defaults.
 *
 * @param projectRoot - Target repository root.
 * @returns Configured mutation score thresholds.
 */
export function loadMutationThresholds(projectRoot: string): MutationThresholds {
  const configPath = path.join(projectRoot, '.swarm', 'gates.yaml');
  if (!fs.existsSync(configPath)) return { ...DEFAULT_MUTATION_THRESHOLDS };

  const parsed = yaml.load(fs.readFileSync(configPath, 'utf8'));
  if (!isRecord(parsed)) return { ...DEFAULT_MUTATION_THRESHOLDS };
  const verification = parsed.verification;
  if (!isRecord(verification)) return { ...DEFAULT_MUTATION_THRESHOLDS };
  const mutation = verification.mutation;
  if (!isRecord(mutation)) return { ...DEFAULT_MUTATION_THRESHOLDS };

  return {
    failBelow: readNumber(mutation, 'failBelow') ?? DEFAULT_MUTATION_THRESHOLDS.failBelow,
    warnBelow: readNumber(mutation, 'warnBelow') ?? DEFAULT_MUTATION_THRESHOLDS.warnBelow,
  };
}

/**
 * Group changed files by mutation tool language.
 *
 * @param changedFiles - Repo-relative changed file paths.
 * @returns Mutation targets for supported languages.
 */
export function detectMutationLanguages(changedFiles: string[]): MutationLanguageTarget[] {
  const jsTs = changedFiles.filter(file =>
    /\.(?:[cm]?js|jsx|ts|tsx)$/.test(file) && !file.endsWith('.d.ts')
  );
  const python = changedFiles.filter(file => file.endsWith('.py'));
  const java = changedFiles.filter(file => file.endsWith('.java'));
  const targets: MutationLanguageTarget[] = [];
  if (jsTs.length > 0) targets.push({ language: 'javascript-typescript', files: jsTs });
  if (python.length > 0) targets.push({ language: 'python', files: python });
  if (java.length > 0) targets.push({ language: 'java', files: java });
  return targets;
}

function javaClassGlobs(files: string[]): string {
  return files.map(file => {
    const normalized = file.replace(/\\/g, '/').replace(/\.java$/, '');
    const marker = '/src/main/java/';
    const idx = normalized.indexOf(marker);
    const classPath = idx >= 0 ? normalized.slice(idx + marker.length) : normalized;
    return classPath.replace(/\//g, '.');
  }).join(',');
}

/**
 * Build the mutation tool command for one language target.
 *
 * @param projectRoot - Target repository root.
 * @param target - Language target to mutate.
 * @returns Shell command scoped to the changed files.
 */
export function buildMutationCommand(projectRoot: string, target: MutationLanguageTarget): string {
  if (target.language === 'javascript-typescript') {
    return `npx stryker run --mutate ${shellQuote(target.files.join(','))} --reporters clear-text`;
  }
  if (target.language === 'python') {
    return `python -m mutmut run --paths-to-mutate ${target.files.map(shellQuote).join(' ')}`;
  }

  const classGlobs = javaClassGlobs(target.files);
  if (fs.existsSync(path.join(projectRoot, 'gradlew'))) {
    return `./gradlew pitest -PtargetClasses=${shellQuote(classGlobs)}`;
  }
  return `mvn org.pitest:pitest-maven:mutationCoverage -DtargetClasses=${shellQuote(classGlobs)}`;
}

function parseCount(text: string, labels: string[]): number | undefined {
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*[:=]?\\s*(\\d+)`, 'i');
    const match = text.match(pattern);
    if (match?.[1]) return Number.parseInt(match[1], 10);
  }
  return undefined;
}

/**
 * Parse common Stryker, mutmut, and PITest output into mutation metrics.
 *
 * @param stdout - Tool stdout.
 * @param stderr - Tool stderr.
 * @returns Parsed mutant counts and score.
 */
export function parseMutationOutput(stdout: string, stderr = ''): {
  totalMutants: number;
  killedMutants: number;
  survivedMutants: number;
  mutationScore: number;
} {
  const text = `${stdout}\n${stderr}`;
  const scoreMatch = text.match(/(?:mutation\s+score|score)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/i);
  const killed = parseCount(text, ['killed mutants', 'killed']);
  const survived = parseCount(text, ['survived mutants', 'survived', 'survivors']);
  const total = parseCount(text, ['total mutants', 'total']);
  const derivedTotal = total ?? (
    killed !== undefined && survived !== undefined ? killed + survived : undefined
  );
  const mutationScore = scoreMatch?.[1]
    ? Number.parseFloat(scoreMatch[1]) / 100
    : derivedTotal && killed !== undefined
      ? killed / derivedTotal
      : 0;

  return {
    totalMutants: derivedTotal ?? 0,
    killedMutants: killed ?? 0,
    survivedMutants: survived ?? Math.max((derivedTotal ?? 0) - (killed ?? 0), 0),
    mutationScore,
  };
}

/**
 * Classify a mutation score against hard-fail and warning thresholds.
 *
 * @param score - Mutation score from 0.0 to 1.0.
 * @param thresholds - Configured mutation score thresholds.
 * @returns Gate status for the score.
 */
export function evaluateMutationScore(
  score: number,
  thresholds: MutationThresholds = DEFAULT_MUTATION_THRESHOLDS,
): Exclude<MutationGateStatus, 'SKIP'> {
  if (score < thresholds.failBelow) return 'FAIL';
  if (score < thresholds.warnBelow) return 'WARNING';
  return 'PASS';
}

/**
 * Run mutation testing against files changed by an agent patch.
 *
 * @param input - Target repo, changed files, thresholds, and optional runner.
 * @returns Structured mutation score evidence.
 */
export async function runMutationGate(input: MutationGateInput): Promise<MutationGateResult> {
  const thresholds = input.thresholds ?? loadMutationThresholds(input.targetRepoPath);
  const targets = detectMutationLanguages(input.changedFiles);
  if (targets.length === 0) {
    return {
      status: 'SKIP',
      reason: 'no changed files use a supported mutation testing language',
      mutationScore: 1,
      thresholds,
      totalMutants: 0,
      killedMutants: 0,
      survivedMutants: 0,
      results: [],
    };
  }

  const runner = input.commandRunner ?? runVerificationCommand;
  const results: MutationToolResult[] = [];
  for (const target of targets) {
    const command = buildMutationCommand(input.targetRepoPath, target);
    const commandResult = await runner(command, input.targetRepoPath, input.timeoutMs ?? 600_000);
    const metrics = parseMutationOutput(commandResult.stdout, commandResult.stderr);
    results.push({
      language: target.language,
      files: target.files,
      command,
      exitCode: commandResult.exitCode,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
      durationMs: commandResult.durationMs,
      ...metrics,
    });
  }

  const totalMutants = results.reduce((sum, result) => sum + result.totalMutants, 0);
  const killedMutants = results.reduce((sum, result) => sum + result.killedMutants, 0);
  const survivedMutants = results.reduce((sum, result) => sum + result.survivedMutants, 0);
  const mutationScore = totalMutants > 0 ? killedMutants / totalMutants : 0;
  const toolFailed = results.some(result => result.exitCode !== 0 && result.totalMutants === 0);
  const status = toolFailed ? 'FAIL' : evaluateMutationScore(mutationScore, thresholds);

  return {
    status,
    reason: toolFailed
      ? 'mutation tool failed before producing a mutation score'
      : `mutation score ${mutationScore.toFixed(3)} produced ${status}`,
    mutationScore,
    thresholds,
    totalMutants,
    killedMutants,
    survivedMutants,
    results,
  };
}
