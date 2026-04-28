#!/usr/bin/env tsx
import * as fs from 'fs';
import {
  appendJsonlRecord,
  evaluateInstancePropertyGate,
  evaluateInstanceSynthesizer,
} from './swebench-instance-evaluator';
import { parseArgs, requiredString } from './eval-utils';

function usage(): void {
  console.log([
    'Usage: tsx scripts/eval/swebench-eval-cli.ts --mode synth|property --task task.json --out file.jsonl',
    '',
    'task.json (synth mode): {',
    '  "instanceId": "...",',
    '  "problemStatement": "...",',
    '  "repoPath": "/abs/path/to/checkout",',
    '  "goldPatchRef": "gold-eval"  // optional git ref carrying the gold patch',
    '}',
    '',
    'task.json (property mode): {',
    '  "instanceId": "...",',
    '  "repoPath": "/abs/path/to/checkout",',
    '  "goldPatchText": "diff --git ...",',
    '  "baseCommit": "abc123"',
    '}',
  ].join('\n'));
}

interface RawTaskInput {
  instanceId?: unknown;
  problemStatement?: unknown;
  repoPath?: unknown;
  goldPatchRef?: unknown;
  goldPatchText?: unknown;
  baseCommit?: unknown;
}

function readTask(taskPath: string): RawTaskInput {
  const parsed: unknown = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`task file ${taskPath} must contain a JSON object`);
  }
  return parsed as RawTaskInput;
}

function asString(v: unknown, key: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`task field ${key} must be a non-empty string`);
  }
  return v;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const mode = requiredString(args, 'mode');
  const taskPath = requiredString(args, 'task');
  const outPath = requiredString(args, 'out');

  const task = readTask(taskPath);

  if (mode === 'synth') {
    const record = await evaluateInstanceSynthesizer({
      instanceId: asString(task.instanceId, 'instanceId'),
      problemStatement: asString(task.problemStatement, 'problemStatement'),
      repoPath: asString(task.repoPath, 'repoPath'),
      ...(typeof task.goldPatchRef === 'string' && task.goldPatchRef.trim() !== ''
        ? { goldPatchRef: task.goldPatchRef }
        : {}),
    });
    appendJsonlRecord(outPath, record);
    return;
  }

  if (mode === 'property') {
    const record = await evaluateInstancePropertyGate({
      instanceId: asString(task.instanceId, 'instanceId'),
      repoPath: asString(task.repoPath, 'repoPath'),
      goldPatchText: asString(task.goldPatchText, 'goldPatchText'),
      ...(typeof task.baseCommit === 'string' && task.baseCommit.trim() !== ''
        ? { baseCommit: task.baseCommit }
        : {}),
    });
    appendJsonlRecord(outPath, record);
    return;
  }

  throw new Error(`unknown --mode ${mode}; use synth or property`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
