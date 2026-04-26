#!/usr/bin/env tsx
import * as fs from 'fs';
import * as path from 'path';
import { runVerificationCommand, synthesizeRegressionTest } from '../../src/verification';
import {
  isRecord,
  parseArgs,
  rate,
  readBoolean,
  readJsonArray,
  readString,
  readStringArray,
  requiredString,
  withWorktree,
  writeReport,
} from './eval-utils';

interface SynthIssue {
  id: string;
  goalText: string;
  repoPath: string;
  bugExists?: boolean;
  knownFixRef?: string;
  relevantFiles?: string[];
}

function usage(): void {
  console.log([
    'Usage: tsx scripts/eval/synthesizer-eval.ts --issues issues.json [--out report.json]',
    '',
    'issues.json: [{',
    '  "id": "case id",',
    '  "goalText": "issue text or user goal",',
    '  "repoPath": "/path/to/repo at base",',
    '  "bugExists": true,',
    '  "knownFixRef": "optional git ref containing the known fix",',
    '  "relevantFiles": ["optional/source/file.ts"]',
    '}]',
  ].join('\n'));
}

function parseIssue(value: unknown, index: number): SynthIssue {
  if (!isRecord(value)) throw new Error(`issue[${index}] must be an object`);
  const id = readString(value, 'id') ?? `issue-${index + 1}`;
  const goalText = readString(value, 'goalText');
  const repoPath = readString(value, 'repoPath');
  if (!goalText || !repoPath) throw new Error(`${id}: goalText and repoPath are required`);
  return {
    id,
    goalText,
    repoPath,
    ...(readBoolean(value, 'bugExists') !== undefined ? { bugExists: readBoolean(value, 'bugExists') } : {}),
    ...(readString(value, 'knownFixRef') ? { knownFixRef: readString(value, 'knownFixRef') } : {}),
    ...(readStringArray(value, 'relevantFiles') ? { relevantFiles: readStringArray(value, 'relevantFiles') } : {}),
  };
}

async function runKnownFix(issue: SynthIssue, testFilePath: string, testCommand: string): Promise<boolean | null> {
  if (!issue.knownFixRef) return null;
  const rel = path.relative(issue.repoPath, testFilePath);
  const source = fs.readFileSync(testFilePath, 'utf8');
  return withWorktree(issue.repoPath, issue.knownFixRef, async (worktreePath) => {
    const target = path.join(worktreePath, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source, 'utf8');
    const result = await runVerificationCommand(testCommand, worktreePath, 120_000);
    return result.exitCode === 0;
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const issuesPath = requiredString(args, 'issues');
  const outPath = typeof args.out === 'string' ? args.out : undefined;
  const issues = readJsonArray(issuesPath).map(parseIssue);
  const cases = [];
  let falsePositives = 0;
  let falsePositiveDenominator = 0;
  let falseNegatives = 0;
  let falseNegativeDenominator = 0;

  for (const issue of issues) {
    const synthesis = await synthesizeRegressionTest({
      goalText: issue.goalText,
      targetRepoPath: issue.repoPath,
      relevantFiles: issue.relevantFiles,
    });
    const baseFailed = synthesis.status === 'GENERATED';
    const knownFixPassed = synthesis.testFilePath && synthesis.testCommand
      ? await runKnownFix(issue, synthesis.testFilePath, synthesis.testCommand)
      : null;

    const falsePositive = issue.bugExists === false && baseFailed;
    const falseNegative = issue.bugExists === true && (!baseFailed || knownFixPassed === false);
    if (issue.bugExists === false) falsePositiveDenominator += 1;
    if (issue.bugExists === true) falseNegativeDenominator += 1;
    if (falsePositive) falsePositives += 1;
    if (falseNegative) falseNegatives += 1;

    cases.push({
      id: issue.id,
      synthesisStatus: synthesis.status,
      baseFailed,
      knownFixPassed,
      falsePositive,
      falseNegative,
      reason: synthesis.reason,
      attempts: synthesis.attempts.length,
    });
  }

  writeReport({
    generatedAt: new Date().toISOString(),
    input: path.resolve(issuesPath),
    cases,
    falsePositiveRate: rate(falsePositives, falsePositiveDenominator),
    falseNegativeRate: rate(falseNegatives, falseNegativeDenominator),
  }, outPath);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
