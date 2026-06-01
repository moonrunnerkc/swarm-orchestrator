// No-op-fix: the PR claims to fix a failing test, but the modified
// non-test code has no plausible relationship to any test in the repo.
//
// v2.0 (v10.3-advisory) composes two independent signals: the
// deterministic v1.1.0 check (kept byte-identical when the judge is
// off, so the no-credentials default contract of `swarm audit`
// holds) and a gated LLM judge that runs only when
// `--enable-llm-judge` or `SWARM_AUDIT_LLM_JUDGE=1` is set. A finding
// fires if either signal says the PR is a no-op fix.
//
// Deterministic signals (unchanged from v1.1.0):
//
// (1) Import-graph reachability. We compute the closure of every
//     test file touched in the PR (or, when no test changed but
//     source did, every touched source file's reverse problem: do
//     *any* repo tests reach it?). The closure is delegated to
//     `reachableSourceFiles` in `test-import-closure.ts`. Python
//     parsing requires `python3` on PATH; the underlying extractor
//     falls back to regex when python3 is missing, which can lose a
//     few edges but never crashes the audit.
//
// (2) Symbol overlap. When both source and tests are touched in the
//     same PR, the added lines on each side must share at least one
//     identifier. If they share none the test changes cannot
//     possibly exercise the source changes, regardless of import
//     structure.
//
// Judge signal (v2.0, opt-in): an Anthropic Haiku call decides
// whether any added or modified non-test code plausibly affects the
// code path the PR title claims to fix. The judge's verdict is
// cached at `.swarm/llm-judge-cache/<sha>.json` and recorded on the
// audit ledger as `llm-judge-result`. A judge YES adds a `warn`
// finding when the deterministic checks would not have fired; a
// judge unavailable adds a single `info` finding noting the fallback.

import * as path from 'path';
import type { Detector, DetectorContext } from './detector-types';
import type { Finding } from '../types';
import { filePath, fileKind, isPlausiblyTestReachable, isTestFile, shouldInspect } from './diff-walker';
import { reachableSourceFiles } from './test-import-closure';
import {
  collectSymbolsFromAddedLines,
  enumerateRepoTestFiles,
  intersect,
  pushDegradationNotices,
} from './no-op-fix-helpers';
import { askJudge } from './llm-judge';

const VERSION = '2.0.0';

export const noOpFixDetector: Detector = {
  name: 'no-op-fix',
  version: VERSION,
  async run(ctx: DetectorContext): Promise<Finding[]> {
    const findings = runDeterministic(ctx);
    if (ctx.judgeConfig?.enabled !== true) return findings;
    const judgeFindings = await runJudge(ctx, findings);
    return [...findings, ...judgeFindings];
  },
};

function runDeterministic(ctx: DetectorContext): Finding[] {
  const sourceTouched: string[] = [];
  const testTouched: string[] = [];
  for (const file of ctx.files) {
    if (!shouldInspect(file)) continue;
    if (fileKind(file) === 'delete') continue;
    const p = filePath(file);
    if (isTestFile(p)) {
      testTouched.push(p);
      continue;
    }
    // The whole detector asks "is this source file reached by any
    // test?" For files outside the test-reachable file class
    // (config, lockfiles, storybook stories, LICENSE), the answer is
    // no by definition, and the finding is just noise. The wild-PR
    // run showed a single docs-shaped PR producing 300+ findings of
    // this exact shape.
    if (!isPlausiblyTestReachable(p)) continue;
    sourceTouched.push(p);
  }

  if (sourceTouched.length === 0 && testTouched.length === 0) return [];

  const sourceSymbols = collectSymbolsFromAddedLines(ctx, (p) => !isTestFile(p));
  const testSymbols = collectSymbolsFromAddedLines(ctx, (p) => isTestFile(p));

  const findings: Finding[] = [];

  if (testTouched.length === 0 && sourceTouched.length > 0) {
    // No test changed; ask the import-graph whether *any* test in
    // the repo transitively reaches each touched source file.
    const allRepoTests = enumerateRepoTestFiles(ctx.repoRoot);
    const closure = reachableSourceFiles(allRepoTests, ctx.repoRoot);
    pushDegradationNotices(findings, closure, sourceTouched[0] ?? '<repo>');

    if (sourceSymbols.size === 0) return findings;
    for (const file of sourceTouched) {
      const abs = path.resolve(ctx.repoRoot, file);
      if (closure.reachable.has(abs)) continue;
      if (closure.capped) continue; // optimistic when cap hit
      findings.push({
        category: 'no-op-fix',
        severity: 'warn',
        message:
          `Source file ${file} was modified but no test file in the repository ` +
          `imports it, directly or transitively. If this PR claimed to fix a ` +
          `failing test, the fix likely missed the failing code path.`,
        location: { file, line: 1 },
        evidence: `(touched: ${sourceTouched.join(', ')})`,
      });
    }
    return findings;
  }

  if (testTouched.length > 0 && sourceTouched.length === 0) {
    for (const file of testTouched) {
      findings.push({
        category: 'no-op-fix',
        severity: 'block',
        message:
          `Test file ${file} was modified but no source file changed in this PR. ` +
          `If the PR claims to fix a failing test, the change likely edits the ` +
          `test rather than the failing implementation.`,
        location: { file, line: 1 },
        evidence: `(touched: ${testTouched.join(', ')})`,
      });
    }
    return findings;
  }

  // Both source and tests touched: symbol overlap is the relevant
  // signal. The import-graph reachability check is implied (the
  // same PR touched both sides, so they're co-located in intent).
  const overlap = intersect(sourceSymbols, testSymbols);
  if (overlap.size === 0 && testSymbols.size > 0 && sourceSymbols.size > 0) {
    for (const file of testTouched) {
      findings.push({
        category: 'no-op-fix',
        severity: 'warn',
        message:
          `Test changes in ${file} share no identifier with the source changes ` +
          `in this PR. The modified test may not exercise the modified code.`,
        location: { file, line: 1 },
        evidence: `(source touched: ${sourceTouched.join(', ')})`,
      });
    }
  }
  return findings;
}

async function runJudge(
  ctx: DetectorContext,
  deterministicFindings: Finding[],
): Promise<Finding[]> {
  const judge = ctx.judgeConfig;
  if (judge === undefined || judge.enabled !== true) return [];
  const pr = ctx.pr;
  if (pr === undefined || pr.title.trim().length === 0) return [];

  const askOpts: Parameters<typeof askJudge>[0] = {
    repoRoot: ctx.repoRoot,
    request: {
      detector: 'no-op-fix',
      prTitle: pr.title,
      unifiedDiff: judge.unifiedDiff,
    },
  };
  if (judge.ledger !== undefined) askOpts.ledger = judge.ledger;
  const result = await askJudge(askOpts);

  const out: Finding[] = [];
  const firstSource = firstSourceFile(ctx);
  const locationFile = firstSource ?? '<diff>';

  if (result.answer === 'unavailable') {
    out.push({
      category: 'no-op-fix',
      severity: 'info',
      message:
        'LLM judge was requested but is unavailable (no ANTHROPIC_API_KEY or ' +
        `the upstream call errored); deterministic-only verdict stands for this run.`,
      location: { file: locationFile, line: 1 },
      evidence: `(modelId: ${result.modelId})`,
    });
    return out;
  }

  // Polarity: the judge prompt asks whether the changed code plausibly
  // AFFECTS the path the PR claims to fix. So judge YES means the fix is
  // plausibly delivered (legitimate) and judge NO means the changed code
  // does not touch the claimed path (the no-op signal). The no-op alarm
  // is the NO case, not the YES case.
  //
  // Judge agrees with a deterministic no-op finding (says NO): attach its
  // reasoning to the existing finding rather than duplicate it.
  if (result.answer === 'no' && deterministicFindings.length > 0) {
    for (const finding of deterministicFindings) {
      finding.judgeModelId = result.modelId;
      if (result.reason !== undefined) finding.judgeReasoning = result.reason;
    }
    return out;
  }

  // Judge says the fix IS delivered (YES) but a deterministic check fired:
  // leave the deterministic finding (the "either fires" composition
  // policy) but record that the judge dissented so the renderer can flag
  // the disagreement.
  if (result.answer === 'yes' && deterministicFindings.length > 0) {
    for (const finding of deterministicFindings) {
      finding.judgeModelId = result.modelId;
      if (result.reason !== undefined) {
        finding.judgeReasoning = `judge dissented: ${result.reason}`;
      }
    }
    return out;
  }

  // Judge-only no-op detection: NO with no deterministic finding. The
  // changed code does not plausibly exercise the claimed fix.
  if (result.answer === 'no' && deterministicFindings.length === 0) {
    const evidenceLine = `(judge NO; modelId: ${result.modelId})`;
    const finding: Finding = {
      category: 'no-op-fix',
      severity: 'warn',
      message:
        'LLM judge reported the PR title claims a fix that the changed ' +
        'non-test code does not plausibly exercise. Deterministic checks ' +
        'did not fire, but the judge\'s reading of intent vs. diff disagrees.',
      location: { file: locationFile, line: 1 },
      evidence: evidenceLine,
      judgeModelId: result.modelId,
    };
    if (result.reason !== undefined) finding.judgeReasoning = result.reason;
    out.push(finding);
  }

  // Judge YES with no deterministic finding: the fix is plausibly
  // delivered, so nothing is raised.
  return out;
}

function firstSourceFile(ctx: DetectorContext): string | undefined {
  for (const file of ctx.files) {
    if (!shouldInspect(file)) continue;
    if (fileKind(file) === 'delete') continue;
    const p = filePath(file);
    if (!isTestFile(p)) return p;
  }
  return undefined;
}
