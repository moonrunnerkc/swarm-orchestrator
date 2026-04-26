#!/usr/bin/env tsx
import * as path from 'path';
import { runPropertyGate } from '../../src/verification';
import {
  applyPatchFile,
  git,
  isRecord,
  parseArgs,
  readBoolean,
  readJsonArray,
  readString,
  readStringArray,
  requiredString,
  withWorktree,
  writeReport,
} from './eval-utils';

interface PropertyPatchCase {
  id: string;
  repoPath: string;
  changedFiles?: string[];
  patchFile?: string;
  baseRef?: string;
  expectedRealBug?: boolean;
}

function usage(): void {
  console.log([
    'Usage: tsx scripts/eval/property-gate-eval.ts --patches patches.json [--out report.json]',
    '',
    'patches.json: [{',
    '  "id": "case id",',
    '  "repoPath": "/path/to/repo",',
    '  "changedFiles": ["src/file.ts"],',
    '  "patchFile": "optional unified diff to apply in a temp worktree",',
    '  "baseRef": "required when patchFile is provided",',
    '  "expectedRealBug": true',
    '}]',
  ].join('\n'));
}

function parseCase(value: unknown, index: number): PropertyPatchCase {
  if (!isRecord(value)) throw new Error(`patch[${index}] must be an object`);
  const id = readString(value, 'id') ?? `patch-${index + 1}`;
  const repoPath = readString(value, 'repoPath');
  if (!repoPath) throw new Error(`${id}: repoPath is required`);
  return {
    id,
    repoPath,
    ...(readStringArray(value, 'changedFiles') ? { changedFiles: readStringArray(value, 'changedFiles') } : {}),
    ...(readString(value, 'patchFile') ? { patchFile: readString(value, 'patchFile') } : {}),
    ...(readString(value, 'baseRef') ? { baseRef: readString(value, 'baseRef') } : {}),
    ...(readBoolean(value, 'expectedRealBug') !== undefined ? { expectedRealBug: readBoolean(value, 'expectedRealBug') } : {}),
  };
}

async function runCase(entry: PropertyPatchCase): Promise<{
  result: Awaited<ReturnType<typeof runPropertyGate>>;
  changedFiles: string[];
}> {
  if (entry.patchFile) {
    if (!entry.baseRef) throw new Error(`${entry.id}: baseRef is required when patchFile is provided`);
    return withWorktree(entry.repoPath, entry.baseRef, async (worktreePath) => {
      applyPatchFile(worktreePath, path.resolve(entry.patchFile!));
      const changedFiles = entry.changedFiles ?? git(worktreePath, ['diff', '--name-only']).split('\n').filter(Boolean);
      return {
        changedFiles,
        result: await runPropertyGate({ targetRepoPath: worktreePath, changedFiles }),
      };
    });
  }

  const changedFiles = entry.changedFiles ?? git(entry.repoPath, ['diff', '--name-only']).split('\n').filter(Boolean);
  return {
    changedFiles,
    result: await runPropertyGate({ targetRepoPath: entry.repoPath, changedFiles }),
  };
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
  let genuineBugs = 0;
  let falseAlarms = 0;

  for (const entry of entries) {
    const { result, changedFiles } = await runCase(entry);
    const found = result.findings.length > 0;
    const genuineBug = entry.expectedRealBug === true && found;
    const falseAlarm = entry.expectedRealBug === false && found;
    if (genuineBug) genuineBugs += 1;
    if (falseAlarm) falseAlarms += 1;
    cases.push({
      id: entry.id,
      changedFiles,
      expectedRealBug: entry.expectedRealBug,
      found,
      genuineBug,
      falseAlarm,
      status: result.status,
      score: result.score,
      targets: result.targets,
      findings: result.findings,
    });
  }

  writeReport({
    generatedAt: new Date().toISOString(),
    input: path.resolve(patchesPath),
    cases,
    signalToNoise: {
      genuineBugs,
      falseAlarms,
      ratio: falseAlarms > 0 ? genuineBugs / falseAlarms : null,
      label: falseAlarms > 0 ? `${genuineBugs / falseAlarms}:1` : (genuineBugs > 0 ? 'Infinity:1' : 'n/a'),
    },
  }, outPath);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
