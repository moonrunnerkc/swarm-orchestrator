import type { File as ParsedDiffFile } from 'parse-diff';
import type { Finding } from '../types';

export interface DetectorContext {
  files: ParsedDiffFile[];
  repoRoot: string;
}

export interface Detector {
  name: string;
  version: string;
  run(ctx: DetectorContext): Finding[];
}
