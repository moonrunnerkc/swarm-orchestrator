// Pure stages of the complaint-mining pipeline, factored out so the
// instrument-verification controls can run each stage on a fixed input list and
// tabulate per-entry outcomes. Everything here is deterministic given its input;
// the network walk lives in run-control.ts. Reuses the shipped instruments
// (detectAgent, extractComplaintSignals, dedupeSignals) rather than reimplementing
// them, so a control measures the real pipeline, not a copy of it.

import { detectAgent } from '../../../src/audit/pr-source';
import type { AuditAgentAttribution } from '../../../src/audit/types';
import { dedupeSignals } from '../mine-complaints';
import { extractComplaintSignals, type ComplaintSignal, type ConversationEntry } from '../lib/github';

export interface PrMeta {
  title: string;
  body: string;
  authorLogin: string;
  headRef: string;
  commitMessages: string[];
}

export interface AttributionModes {
  /** The miner's body-marker-only call (what actually gates the mine). */
  minerMode: AuditAgentAttribution | undefined;
  /** The full-signal call the shipped fingerprinter is designed for. */
  fullMode: AuditAgentAttribution | undefined;
}

/**
 * Run the fingerprinter two ways: the miner's `detectAgent({ prTitle, prBody })`
 * call, and the full-signal call the fingerprinter is built for (author + branch
 * + commit messages). The delta between the two is the attribution narrowing the
 * miner incurs by projecting away the PR author in its global-search results.
 *
 * @param meta the PR's title, body, author login, head ref, and commit messages.
 * @returns the attribution each mode produces (undefined = not attributed).
 */
export function attributionModes(meta: PrMeta): AttributionModes {
  const minerMode = detectAgent({ prTitle: meta.title, prBody: meta.body });
  const fullMode = detectAgent({
    prTitle: meta.title,
    prBody: meta.body,
    headRef: meta.headRef,
    authors: meta.authorLogin.length > 0 ? [meta.authorLogin] : [],
    commitMessages: meta.commitMessages,
  });
  return { minerMode, fullMode };
}

export interface PatternStage {
  hit: boolean;
  signals: ComplaintSignal[];
}

/**
 * The miner's complaint stage: scan every human conversation entry for a
 * cheat-complaint pattern, deduped by (category, phrase). A hit is one or more
 * signals; the first signal is the category the pipeline would carry forward.
 *
 * @param conversation the PR's human review/issue comments.
 * @returns whether a complaint pattern matched and the deduped signals.
 */
export function patternStage(conversation: readonly ConversationEntry[]): PatternStage {
  const signals = dedupeSignals(conversation.flatMap((c) => extractComplaintSignals(c.body, c.source)));
  return { hit: signals.length > 0, signals };
}

export interface ArbiterRecord {
  source: 'fresh' | 'reused-committed';
  primary: { model: string; verdict: string; confidence: number };
  secondary: { model: string; verdict: string; confidence: number };
  agreed: boolean;
  confirmed: boolean | null;
}

export interface ControlEntryLike {
  pattern: { hit: boolean };
  attribution: { minerAttributed: boolean; fullAttributed: boolean };
  arbiter?: Pick<ArbiterRecord, 'confirmed' | 'agreed'> | undefined;
}

export interface ControlSummary {
  total: number;
  patternHit: number;
  minerAttributed: number;
  fullAttributed: number;
  /** Attributed by the full-signal call but missed by the miner's body-only call. */
  fullOnlyAttributed: number;
  arbiterEvaluated: number;
  arbiterConfirmed: number;
  arbiterFalseAlarm: number;
  arbiterSplit: number;
}

/**
 * Fold per-entry control outcomes into the funnel the report tabulates. Pure so
 * it is unit-tested against fixed entries rather than a live run.
 *
 * @param entries the per-entry outcomes from a control run.
 * @returns the aggregate funnel counts.
 */
export function summarizeControl(entries: readonly ControlEntryLike[]): ControlSummary {
  const s: ControlSummary = {
    total: entries.length,
    patternHit: 0,
    minerAttributed: 0,
    fullAttributed: 0,
    fullOnlyAttributed: 0,
    arbiterEvaluated: 0,
    arbiterConfirmed: 0,
    arbiterFalseAlarm: 0,
    arbiterSplit: 0,
  };
  for (const e of entries) {
    if (e.pattern.hit) s.patternHit += 1;
    if (e.attribution.minerAttributed) s.minerAttributed += 1;
    if (e.attribution.fullAttributed) s.fullAttributed += 1;
    if (e.attribution.fullAttributed && !e.attribution.minerAttributed) s.fullOnlyAttributed += 1;
    if (e.arbiter !== undefined) {
      s.arbiterEvaluated += 1;
      if (e.arbiter.confirmed === true) s.arbiterConfirmed += 1;
      else if (e.arbiter.agreed === false) s.arbiterSplit += 1;
      else s.arbiterFalseAlarm += 1;
    }
  }
  return s;
}
