import * as fs from 'fs';
import * as path from 'path';
import { runVerificationCommand, VerificationCommandResult } from './command-runner';
import { createFinding, type Finding } from '../types/finding';

export type PropertyGateStatus = 'PASS' | 'ADVISORY' | 'SKIP';
export type PropertyLanguage = 'typescript' | 'javascript' | 'python';

export interface PropertyTarget {
  language: PropertyLanguage;
  filePath: string;
  line: number;
  functionName: string;
  typed: boolean;
  advisoryOnly: boolean;
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

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
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

function discoverInSource(filePath: string, source: string): PropertyTarget[] {
  const ext = path.extname(filePath);
  const targets: PropertyTarget[] = [];
  if (ext === '.py') {
    for (const match of source.matchAll(/(?:^|\n)def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*([^:]*):/g)) {
      const typed = isTypedPythonSignature(match[2] ?? '', match[3] ?? '');
      targets.push({
        language: 'python',
        filePath,
        line: declarationLine(source, match.index ?? 0, match[0]),
        functionName: match[1] ?? 'unknown',
        typed,
        advisoryOnly: !typed,
      });
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
      const typed = language === 'typescript'
        ? isTypedTypeScriptSignature(match[2] ?? '', match[3] ?? '')
        : false;
      targets.push({
        language,
        filePath,
        line: declarationLine(source, match.index ?? 0, match[0]),
        functionName: match[1] ?? 'unknown',
        typed,
        advisoryOnly: language === 'javascript' || !typed,
      });
    }
  }
  return targets;
}

/**
 * Discover modified functions that can receive generated property tests.
 *
 * @param repoPath - Target repository root.
 * @param changedFiles - Repo-relative changed file paths.
 * @returns Function targets with type-system coverage metadata.
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

function jsHarness(target: PropertyTarget, importRel: string): string {
  const importPath = importRel.startsWith('.') ? importRel : './' + importRel;
  return [
    "const fc = require('fast-check');",
    `const mod = require('${importPath}');`,
    `const fn = mod.${target.functionName};`,
    "if (typeof fn !== 'function') throw new Error('target function is not exported');",
    'fc.assert(fc.property(fc.anything(), fc.anything(), (a, b) => {',
    '  try { fn(a, b); return true; }',
    "  catch (err) { throw new Error('Counterexample: ' + JSON.stringify([a, b]) + ' -> ' + err.message); }",
    '}), { numRuns: 100 });',
    '',
  ].join('\n');
}

function pythonHarness(target: PropertyTarget, moduleName: string): string {
  return [
    'from hypothesis import given, strategies as st',
    `from ${moduleName} import ${target.functionName}`,
    '',
    '@given(st.integers(), st.integers())',
    'def test_generated_property(a, b):',
    `    ${target.functionName}(a, b)`,
    '',
    'if __name__ == "__main__":',
    '    test_generated_property()',
    '',
  ].join('\n');
}

function pythonModuleName(filePath: string): string {
  return filePath.replace(/\.py$/, '').replace(/[\\/]/g, '.').replace(/^\.+/, '');
}

function buildPropertyCommand(repoPath: string, target: PropertyTarget): string {
  const outDir = path.join(repoPath, '.swarm', 'property-tests');
  fs.mkdirSync(outDir, { recursive: true });
  const base = `${safeName(target.filePath)}-${safeName(target.functionName)}`;

  if (target.language === 'python') {
    const harness = path.join(outDir, `${base}.py`);
    fs.writeFileSync(harness, pythonHarness(target, pythonModuleName(target.filePath)), 'utf8');
    return `python ${path.relative(repoPath, harness)}`;
  }

  const extension = target.language === 'typescript' ? '.ts' : '.js';
  const harness = path.join(outDir, `${base}${extension}`);
  const targetPath = path.join(repoPath, target.filePath);
  const importRel = path.relative(path.dirname(harness), targetPath).replace(/\\/g, '/');
  fs.writeFileSync(harness, jsHarness(target, importRel), 'utf8');
  return target.language === 'typescript'
    ? `npx tsx ${path.relative(repoPath, harness)}`
    : `node ${path.relative(repoPath, harness)}`;
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

/**
 * Run generated property-based tests for modified functions.
 *
 * Untyped JavaScript is intentionally advisory-only because generators cannot
 * be type-directed; the gate still fuzzes with generic values and reports a
 * reduced-confidence finding when a counterexample appears.
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
    const command = buildPropertyCommand(input.targetRepoPath, target);
    const result = await runner(command, input.targetRepoPath, input.timeoutMsPerFunction ?? 60_000);
    if (result.exitCode !== 0) {
      const output = `${result.stdout}\n${result.stderr}`;
      const counterexample = extractCounterexample(output);
      findings.push(propertyFinding(target, counterexample));
    }
  }

  return {
    status: findings.length > 0 ? 'ADVISORY' : 'PASS',
    score: Math.max(0, Number((1 - findings.length * 0.25).toFixed(3))),
    targets,
    findings,
  };
}
