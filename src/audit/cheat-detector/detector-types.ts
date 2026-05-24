import type { File as ParsedDiffFile } from 'parse-diff';
import type { AuditInput, Finding } from '../types';

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
}

export interface Detector {
  name: string;
  version: string;
  run(ctx: DetectorContext): Finding[] | Promise<Finding[]>;
}
