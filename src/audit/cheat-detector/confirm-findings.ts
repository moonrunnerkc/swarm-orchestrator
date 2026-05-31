// LLM-judge confirmation gate. The deterministic detectors and the
// verification refuters together are tuned for precision-safety, but a
// syntactic detector still cannot tell an intentional empty catch from a
// swallowed error, or a real-but-unusual mock from a hallucinated one.
// This gate asks the judge to confirm a candidate before it is allowed
// to block: a NO downgrades the finding to advisory, a YES keeps it and
// attaches the model's reasoning, and an unavailable judge leaves the
// deterministic verdict standing so the no-credentials default is
// unchanged.
//
// The gate runs once per (PR, category): every error-swallow finding on
// one PR shares the same diff-and-category question, and the judge cache
// collapses them into a single call. The `confirm:<category>` detector
// marker keeps these answers in their own cache and ledger namespace,
// separate from the no-op-fix detector's own judge usage.

import type { CheatCategory, Finding, JudgeLedgerSink } from '../types';
import { askJudge } from './llm-judge';
import type { JudgeClient } from './llm-judge';

export interface ConfirmContext {
  unifiedDiff: string;
  prTitle: string;
  repoRoot: string;
  ledger?: JudgeLedgerSink;
  /** Test seam: inject a judge client instead of the real Anthropic one. */
  client?: JudgeClient;
  /** When false, the judge never makes a live call (test default). */
  allowLiveCall?: boolean;
}

export interface ConfirmResult {
  findings: Finding[];
  /** Findings the judge refuted (downgraded from block to advisory). */
  refuted: Finding[];
}

// Categories the gate is allowed to act on. Each has a confirmation
// question in `anthropic-judge.ts`. Categories absent here are passed
// through untouched.
const CONFIRMABLE: ReadonlySet<CheatCategory> = new Set<CheatCategory>([
  'error-swallow',
  'mock-of-hallucination',
  'no-op-fix',
  'fake-refactor',
  'coverage-erosion',
  'test-relaxation',
  'assertion-strip',
]);

/**
 * Gate block-severity findings through the judge. Returns the findings
 * with refuted blocks downgraded to `warn`, plus the list of refuted
 * findings for the ledger and shadow output.
 */
export async function confirmFindings(
  findings: readonly Finding[],
  ctx: ConfirmContext,
): Promise<ConfirmResult> {
  // One judge verdict per category that has at least one block finding.
  const categoriesToConfirm = new Set<CheatCategory>();
  for (const f of findings) {
    if (f.severity === 'block' && CONFIRMABLE.has(f.category)) {
      categoriesToConfirm.add(f.category);
    }
  }

  const verdicts = new Map<CheatCategory, { answer: string; reason?: string; modelId: string }>();
  for (const category of categoriesToConfirm) {
    const askOpts: Parameters<typeof askJudge>[0] = {
      repoRoot: ctx.repoRoot,
      // askJudge caps the diff to Haiku's context window centrally.
      request: {
        detector: `confirm:${category}`,
        prTitle: ctx.prTitle,
        unifiedDiff: ctx.unifiedDiff,
      },
    };
    if (ctx.ledger !== undefined) askOpts.ledger = ctx.ledger;
    if (ctx.client !== undefined) askOpts.client = ctx.client;
    if (ctx.allowLiveCall !== undefined) askOpts.allowLiveCall = ctx.allowLiveCall;
    const result = await askJudge(askOpts);
    const verdict: { answer: string; reason?: string; modelId: string } = {
      answer: result.answer,
      modelId: result.modelId,
    };
    if (result.reason !== undefined) verdict.reason = result.reason;
    verdicts.set(category, verdict);
  }

  const out: Finding[] = [];
  const refuted: Finding[] = [];
  for (const f of findings) {
    const verdict = f.severity === 'block' ? verdicts.get(f.category) : undefined;
    if (verdict === undefined) {
      out.push(f);
      continue;
    }
    f.judgeModelId = verdict.modelId;
    if (verdict.answer === 'no') {
      // Refuted: drop to advisory so it never blocks, and record why.
      f.severity = 'warn';
      f.judgeReasoning = `judge refuted the block: ${verdict.reason ?? 'no reason given'}`;
      refuted.push(f);
    } else if (verdict.answer === 'yes') {
      f.judgeConfirmed = true;
      if (verdict.reason !== undefined) f.judgeReasoning = verdict.reason;
    }
    out.push(f);
  }
  return { findings: out, refuted };
}
