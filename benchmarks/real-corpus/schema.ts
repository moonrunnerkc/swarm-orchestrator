// Real-corpus entry shape for the v10.1 PR-derived leaderboard. Parallel
// to `benchmarks/falsification-corpus/schema.ts` (the v8-shaped
// verification-run schema) — kept separate so PR fixtures do not have
// to pretend to be verification-run steps.
//
// `GroundTruthLabel` / `BrokenCategory` are reused from the
// falsification-corpus schema verbatim; only the entry envelope is new.
//
// The `agent.vendor` field is an *open* string (not the closed
// `AgentCli` enum) because the v10 PR-source fingerprinter already
// emits eight vendors (`claude-code`, `cursor`, `devin`, `aider`,
// `codex-cli`, `copilot-workspace`, `replit-agent`, `openhands`) and
// will gain more as new agents ship. A closed enum would force a
// schema change for every new agent.

import type { GroundTruthLabel } from '../falsification-corpus/schema';

export type { BrokenCategory, GroundTruthLabel } from '../falsification-corpus/schema';

export type AttributionConfidence = 'high' | 'medium' | 'low';

export interface PrAgentAttribution {
  vendor: string;
  version?: string;
  confidence: AttributionConfidence;
  source: string;
}

export interface PrMetadata {
  number: number;
  headSha: string;
  baseSha: string;
  headRef: string;
  title: string;
  body: string;
  author: string;
  repository: string;
}

export interface PrDiffRef {
  repository: string;
  headSha: string;
  baseSha: string;
}

/** PR-shaped corpus entry before any human label is attached. */
export interface UnlabeledPrCorpusEntry {
  id: string;
  agent: PrAgentAttribution;
  pr: PrMetadata;
  diffRef: PrDiffRef;
  /**
   * Path (relative to the corpus root) of the vendored fallback diff.
   * Kept alongside `diffRef` so the entry stays scorable when the source
   * repository is deleted or made private.
   */
  vendoredDiffPath: string;
  vendoredAt: string;
  collectedAt: string;
}

/** Labeled PR corpus entry: `UnlabeledPrCorpusEntry` plus a hand label. */
export interface PrCorpusEntry extends UnlabeledPrCorpusEntry {
  groundTruth: GroundTruthLabel;
}

/** Canonical id format: `<vendor>-<owner>-<repo>-pr<number>`. */
export function buildPrEntryId(vendor: string, repository: string, prNumber: number): string {
  const repoSlug = repository.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${vendor}-${repoSlug}-pr${prNumber}`;
}

/**
 * Structural validator. Returns the list of human-readable schema
 * violations. Empty list means the value is a valid
 * `UnlabeledPrCorpusEntry`. Does not validate `groundTruth`; that lives
 * in `label-rules.validateGroundTruthLabel`.
 */
export function validateUnlabeledPrEntry(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return ['entry is not an object'];
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    errors.push('id must be a non-empty string');
  }
  errors.push(...validateAgent(value.agent));
  errors.push(...validatePrMetadata(value.pr));
  errors.push(...validateDiffRef(value.diffRef));
  if (typeof value.vendoredDiffPath !== 'string' || value.vendoredDiffPath.length === 0) {
    errors.push('vendoredDiffPath must be a non-empty string');
  }
  if (typeof value.vendoredAt !== 'string' || Number.isNaN(Date.parse(value.vendoredAt))) {
    errors.push('vendoredAt must be an ISO timestamp');
  }
  if (typeof value.collectedAt !== 'string' || Number.isNaN(Date.parse(value.collectedAt))) {
    errors.push('collectedAt must be an ISO timestamp');
  }
  return errors;
}

function validateAgent(value: unknown): string[] {
  if (!isRecord(value)) return ['agent is missing or not an object'];
  const errors: string[] = [];
  if (typeof value.vendor !== 'string' || value.vendor.length === 0) {
    errors.push('agent.vendor must be a non-empty string');
  }
  if (value.version !== undefined && typeof value.version !== 'string') {
    errors.push('agent.version must be a string when present');
  }
  if (value.confidence !== 'high' && value.confidence !== 'medium' && value.confidence !== 'low') {
    errors.push('agent.confidence must be one of high, medium, low');
  }
  if (typeof value.source !== 'string' || value.source.length === 0) {
    errors.push('agent.source must be a non-empty string');
  }
  return errors;
}

function validatePrMetadata(value: unknown): string[] {
  if (!isRecord(value)) return ['pr is missing or not an object'];
  const errors: string[] = [];
  if (!Number.isInteger(value.number) || (value.number as number) <= 0) {
    errors.push('pr.number must be a positive integer');
  }
  for (const key of ['headSha', 'baseSha', 'headRef', 'title', 'author', 'repository'] as const) {
    if (typeof value[key] !== 'string' || (value[key] as string).length === 0) {
      errors.push(`pr.${key} must be a non-empty string`);
    }
  }
  if (typeof value.body !== 'string') {
    errors.push('pr.body must be a string (may be empty)');
  }
  return errors;
}

function validateDiffRef(value: unknown): string[] {
  if (!isRecord(value)) return ['diffRef is missing or not an object'];
  const errors: string[] = [];
  for (const key of ['repository', 'headSha', 'baseSha'] as const) {
    if (typeof value[key] !== 'string' || (value[key] as string).length === 0) {
      errors.push(`diffRef.${key} must be a non-empty string`);
    }
  }
  return errors;
}

/**
 * Type guard for hot paths that need to narrow without enumerating
 * field errors. For human-facing error reporting, prefer
 * `validateUnlabeledPrEntry`.
 */
export function isUnlabeledPrEntry(value: unknown): value is UnlabeledPrCorpusEntry {
  return validateUnlabeledPrEntry(value).length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
