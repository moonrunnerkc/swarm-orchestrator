import type { File as ParsedDiffFile } from 'parse-diff';
import type { AuditInput, Finding, JudgeLedgerSink } from '../types';

export interface DetectorJudgeConfig {
  enabled: boolean;
  unifiedDiff: string;
  ledger?: JudgeLedgerSink;
}

export interface DetectorContext {
  files: ParsedDiffFile[];
  repoRoot: string;
  /**
   * Optional PR metadata threaded through from `AuditInput.pr`. Most
   * detectors ignore this; the PR-intent layer in the engine reads
   * it post-hoc via `pr-intent.parsePrIntent`. A detector that needs
   * to read the title/body directly may, but the default policy
   * lives in the engine so individual detectors stay PR-agnostic.
   */
  pr?: AuditInput['pr'];
  /**
   * v10.3 LLM-judge configuration. Off by default; detectors that
   * integrate the judge (currently `no-op-fix`) read this from the
   * context and call `askJudge` themselves so the per-detector
   * composition policy stays local to each detector.
   */
  judgeConfig?: DetectorJudgeConfig;
}

export interface Detector {
  name: string;
  version: string;
  run(ctx: DetectorContext): Finding[] | Promise<Finding[]>;
}
