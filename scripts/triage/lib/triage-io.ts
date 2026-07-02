// Shared IO and split helpers for the triage orchestration scripts. One place
// for the dataset/verdict loaders, the evaluation-label mapping, and the
// deterministic train/calibration/test split, so featurize, label-model, rank,
// and calibrate all agree.

import * as fs from 'fs';
import * as path from 'path';
import type { JudgeVerdict } from '../../../src/audit/triage/denoise';
import type { LabelTier, TriageDataset } from '../../../src/audit/triage/types';
import { repoRoot } from '../../real-prs/lib/paths';

export type EvalLabel = 0 | 1 | null;
export type Split = 'train' | 'calibration' | 'test';

export function triageDir(root = repoRoot()): string {
  return path.join(root, 'benchmarks', 'triage');
}

export function loadDataset(root = repoRoot()): TriageDataset {
  const file = path.join(triageDir(root), 'triage-dataset.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as TriageDataset;
}

/** Judge verdicts by instance id; empty map when the denoise pass has not run. */
export function loadVerdicts(root = repoRoot()): Map<string, JudgeVerdict> {
  const file = path.join(triageDir(root), 'judge-verdicts.json');
  const map = new Map<string, JudgeVerdict>();
  if (!fs.existsSync(file)) return map;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    verdicts: Array<{ id: string; verdict: JudgeVerdict }>;
  };
  for (const v of parsed.verdicts) map.set(v.id, v.verdict);
  return map;
}

/**
 * The evaluation ground-truth label for a tier. Oracle injections and proven
 * restorations are true cheats (1); presumed-clean PRs are true negatives (0);
 * the weak revert tier has no trustworthy label (null), so it is excluded from
 * evaluation but still trains the label model and ranker.
 */
export function evalLabel(tier: LabelTier): EvalLabel {
  if (tier === 'oracle-injected' || tier === 'restoration-proof') return 1;
  if (tier === 'clean-presumed') return 0;
  return null;
}

/** Deterministic FNV-1a hash of an id into [0, 1). */
export function hashUnit(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

/**
 * Deterministic split. Evaluation instances (known label) are held out into
 * calibration (first quarter by hash) and test (second quarter); everything
 * else, including all weak revert instances, trains the ranker, so the
 * held-out splits never leak into training.
 */
export function splitOf(id: string, tier: LabelTier): Split {
  if (evalLabel(tier) === null) return 'train';
  const u = hashUnit(id);
  if (u < 0.25) return 'calibration';
  if (u < 0.5) return 'test';
  return 'train';
}
