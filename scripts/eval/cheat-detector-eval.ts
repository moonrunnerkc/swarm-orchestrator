#!/usr/bin/env tsx
import * as fs from 'fs';
import * as path from 'path';
import { runCheatDetector } from '../../src/verification';
import {
  isRecord,
  parseArgs,
  rate,
  readBoolean,
  readJsonArray,
  readString,
  readStringArray,
  requiredString,
  writeReport,
} from './eval-utils';

interface PatchCase {
  id: string;
  repoPath: string;
  goalText: string;
  diffText?: string;
  patchFile?: string;
  baseRef?: string;
  patchRef?: string;
  allowedTestFiles?: string[];
  expectedCheat?: boolean;
}

function usage(): void {
  console.log([
    'Usage: tsx scripts/eval/cheat-detector-eval.ts --patches patches.json [--out report.json]',
    '',
    'patches.json: [{',
    '  "id": "case id",',
    '  "repoPath": "/path/to/repo",',
    '  "goalText": "goal used for the patch",',
    '  "patchFile": "optional unified diff path",',
    '  "diffText": "optional inline diff",',
    '  "baseRef": "optional git ref",',
    '  "patchRef": "optional git ref",',
    '  "expectedCheat": false',
    '}]',
  ].join('\n'));
}

function parseCase(value: unknown, index: number): PatchCase {
  if (!isRecord(value)) throw new Error(`patch[${index}] must be an object`);
  const id = readString(value, 'id') ?? `patch-${index + 1}`;
  const repoPath = readString(value, 'repoPath');
  const goalText = readString(value, 'goalText');
  if (!repoPath || !goalText) throw new Error(`${id}: repoPath and goalText are required`);
  return {
    id,
    repoPath,
    goalText,
    ...(readString(value, 'diffText') ? { diffText: readString(value, 'diffText') } : {}),
    ...(readString(value, 'patchFile') ? { patchFile: readString(value, 'patchFile') } : {}),
    ...(readString(value, 'baseRef') ? { baseRef: readString(value, 'baseRef') } : {}),
    ...(readString(value, 'patchRef') ? { patchRef: readString(value, 'patchRef') } : {}),
    ...(readStringArray(value, 'allowedTestFiles') ? { allowedTestFiles: readStringArray(value, 'allowedTestFiles') } : {}),
    ...(readBoolean(value, 'expectedCheat') !== undefined ? { expectedCheat: readBoolean(value, 'expectedCheat') } : {}),
  };
}

function resolvePatchText(entry: PatchCase): string | undefined {
  if (entry.diffText !== undefined) return entry.diffText;
  if (!entry.patchFile) return undefined;
  return fs.readFileSync(path.resolve(entry.patchFile), 'utf8');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const patchesPath = requiredString(args, 'patches');
  const outPath = typeof args.out === 'string' ? args.out : undefined;
  const entries = readJsonArray(patchesPath).map(parseCase);
  const cases = [];
  let falsePositives = 0;
  let cleanCount = 0;
  let knownCheatMisses = 0;
  let knownCheatCount = 0;

  for (const entry of entries) {
    const result = await runCheatDetector({
      repoPath: entry.repoPath,
      goalText: entry.goalText,
      diffText: resolvePatchText(entry),
      baseRef: entry.baseRef,
      patchRef: entry.patchRef,
      allowedTestFiles: entry.allowedTestFiles,
    });
    const flagged = result.findings.length > 0;
    const falsePositive = entry.expectedCheat === false && flagged;
    const missedKnownCheat = entry.expectedCheat === true && !flagged;
    if (entry.expectedCheat === false) cleanCount += 1;
    if (entry.expectedCheat === true) knownCheatCount += 1;
    if (falsePositive) falsePositives += 1;
    if (missedKnownCheat) knownCheatMisses += 1;
    cases.push({
      id: entry.id,
      flagged,
      expectedCheat: entry.expectedCheat,
      falsePositive,
      missedKnownCheat,
      score: result.score,
      semgrepStatus: result.semgrepStatus,
      findings: result.findings,
    });
  }

  writeReport({
    generatedAt: new Date().toISOString(),
    input: path.resolve(patchesPath),
    cases,
    falsePositiveRate: rate(falsePositives, cleanCount),
    knownCheatMissRate: rate(knownCheatMisses, knownCheatCount),
  }, outPath);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
