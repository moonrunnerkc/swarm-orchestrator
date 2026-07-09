// Shared loader and evaluator for the false-positive regression registry
// (benchmarks/real-corpus/fp-registry/). One JSON entry per diagnosed gate FP,
// beside its committed PR diff. Two consumers read it: check-fp-registry.ts (the
// CI ratchet: no gate trigger may fire on a neutralized entry) and
// compute/check-block-eligibility (a live-fp entry flows into the trigger's
// revert-calibration denominator). Pure evaluation lives here so the CI script
// and the mocha regression test agree by construction.

import * as fs from 'fs';
import * as path from 'path';
import type { BlockTriggerKind } from '../../src/audit/gate/block-trigger-types';
import type { CheatCategory } from '../../src/audit/types';
import type { RegistryFalsePositive } from '../../src/audit/gate/block-eligibility';
import { coverageRelocated } from '../../src/audit/execution-grounded/test-restoration';

export type FpDisposition = 'neutralized-by-refuter' | 'live-fp';
export type FpRefuter = 'coverage-relocated';

export interface FpRegistryEntry {
  id: string;
  pr: string;
  headSha: string;
  baseSha: string;
  firedTrigger: BlockTriggerKind;
  category: CheatCategory;
  findingFiles: string[];
  diagnosis: string;
  disposition: FpDisposition;
  refuter?: FpRefuter;
  diffFile: string;
  recordRef?: string;
  source?: string;
}

export const DEFAULT_FP_REGISTRY_DIR = path.join('benchmarks', 'real-corpus', 'fp-registry');

/** Load every registry entry from `dir`, sorted by id for determinism. Skips
 *  README.md and the .diff payloads; reads only the *.json entry files. */
export function loadRegistry(dir: string = DEFAULT_FP_REGISTRY_DIR): FpRegistryEntry[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as FpRegistryEntry);
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

/** Read the committed unified diff an entry replays against. */
export function loadEntryDiff(entry: FpRegistryEntry, dir: string = DEFAULT_FP_REGISTRY_DIR): string {
  return fs.readFileSync(path.join(dir, entry.diffFile), 'utf8');
}

/** The still-live false positives, as block-eligibility denominator input. A
 *  `neutralized-by-refuter` entry no longer fires, so it contributes nothing. */
export function liveFalsePositives(entries: readonly FpRegistryEntry[]): RegistryFalsePositive[] {
  return entries
    .filter((e) => e.disposition === 'live-fp')
    .map((e) => ({ trigger: e.firedTrigger, pr: e.pr }));
}

export interface EntryEvaluation {
  id: string;
  neutralized: boolean;
  detail: string;
}

/**
 * Pure: does the entry's named refuter still neutralize its firing on the
 * committed diff? For a `neutralized-by-refuter` entry the refuter must fire on
 * EVERY finding file (so the gate's proof downgrades rather than blocks); if it
 * fails on any, the entry would gate again and CI must go red. A `live-fp` entry
 * is not expected to be neutralized (it flows into the demotion denominator
 * instead), so it evaluates as neutralized:false with an explanatory detail and
 * is not treated as a failure by the checker.
 *
 * @param entry the registry entry.
 * @param diff the committed PR diff for the entry.
 * @returns whether the refuter still fires on every finding file, with detail.
 */
export function evaluateEntry(entry: FpRegistryEntry, diff: string): EntryEvaluation {
  if (entry.disposition === 'live-fp') {
    return {
      id: entry.id,
      neutralized: false,
      detail: `live-fp: no refuter yet; flows into ${entry.firedTrigger} block-eligibility denominator`,
    };
  }
  if (entry.refuter !== 'coverage-relocated') {
    return { id: entry.id, neutralized: false, detail: `unknown refuter '${entry.refuter ?? '(none)'}'` };
  }
  const missed = entry.findingFiles.filter((f) => coverageRelocated(diff, f) === null);
  if (missed.length > 0) {
    return {
      id: entry.id,
      neutralized: false,
      detail: `coverage-relocated refuter did NOT fire on: ${missed.join(', ')}`,
    };
  }
  return {
    id: entry.id,
    neutralized: true,
    detail: `coverage-relocated refuter fires on all ${entry.findingFiles.length} finding file(s)`,
  };
}
