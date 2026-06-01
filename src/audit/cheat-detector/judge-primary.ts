// Judge-as-primary detector. The structural detectors are blind to the
// semantic cheats (goal-not-fixed, cheat-mock-mutation): the diff looks
// legitimate, so there is no candidate for the confirmation gate to
// confirm. This path runs the judge directly against the diff and the
// PR's stated claim, and raises a finding when the judge says the claim
// is not delivered. It is gated by `judgePrimary.enabled` in
// .swarm/audit-config.yaml and defaults on; with no model configured the
// judge returns `unavailable` and no finding is raised, so the
// no-credentials default path is unchanged.

import type { File as ParsedDiffFile } from 'parse-diff';
import type { Finding, JudgeLedgerSink, SemanticCheatCategory } from '../types';
import { filePath, fileKind } from './diff-walker';
import { askJudge } from './llm-judge';
import type { JudgeClient } from './llm-judge';

export interface JudgePrimaryContext {
  unifiedDiff: string;
  /** The PR's stated intent. The judge decides whether the diff delivers it. */
  claim: string;
  repoRoot: string;
  files: ParsedDiffFile[];
  categories: readonly SemanticCheatCategory[];
  ledger?: JudgeLedgerSink;
  /** Test seam: inject a judge client. */
  client?: JudgeClient;
  /** When false, never make a live call (returns no findings). */
  allowLiveCall?: boolean;
  /** Promote judge-primary findings from advisory `warn` to gating
   *  `block`. Off by default: the path ships advisory until a consumer has
   *  its own per-repo false-positive data to justify blocking. Set via
   *  `judgePrimary.block: true` in .swarm/audit-config.yaml. */
  block?: boolean;
}

const CATEGORY_MESSAGE: Record<SemanticCheatCategory, string> = {
  'goal-not-fixed':
    'The judge found the PR does not deliver its stated fix: the claimed condition is still unhandled.',
  'cheat-mock-mutation':
    'The judge found the test was rewired so the assertion passes against a mocked value instead of the real unit.',
};

export async function runJudgePrimary(ctx: JudgePrimaryContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  const location = primaryLocation(ctx.files);
  for (const category of ctx.categories) {
    const askOpts: Parameters<typeof askJudge>[0] = {
      repoRoot: ctx.repoRoot,
      request: {
        detector: `primary:${category}`,
        prTitle: ctx.claim,
        unifiedDiff: ctx.unifiedDiff,
      },
    };
    if (ctx.ledger !== undefined) askOpts.ledger = ctx.ledger;
    if (ctx.client !== undefined) askOpts.client = ctx.client;
    if (ctx.allowLiveCall !== undefined) askOpts.allowLiveCall = ctx.allowLiveCall;
    const verdict = await askJudge(askOpts);
    if (verdict.answer !== 'yes') continue;
    const finding: Finding = {
      category,
      severity: ctx.block === true ? 'block' : 'warn',
      message: CATEGORY_MESSAGE[category],
      location,
      evidence: `claim: ${ctx.claim}`,
      judgePrimary: true,
      judgeConfirmed: true,
      judgeModelId: verdict.modelId,
    };
    if (verdict.reason !== undefined) finding.judgeReasoning = verdict.reason;
    findings.push(finding);
  }
  return findings;
}

/** Best-effort location: the first changed non-deleted file. Per-hunk
 *  localization is a separate path; here the finding points at the PR as
 *  a whole via its first touched file. */
function primaryLocation(files: ParsedDiffFile[]): Finding['location'] {
  for (const f of files) {
    const kind = fileKind(f);
    if (kind === 'add' || kind === 'modify' || kind === 'rename') {
      return { file: filePath(f), line: 1 };
    }
  }
  return { file: files[0] ? filePath(files[0]) : '(diff)', line: 1 };
}
