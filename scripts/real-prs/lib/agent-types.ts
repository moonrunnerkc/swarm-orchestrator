// Shapes for the agent corpus: merged PRs the shipped fingerprinter
// attributes to an AI coding agent. Mirrors SourcePr/SourcesFile so the
// audit and arbiter stages can treat the corpus like the clean one.

import type { AuditAgentAttribution } from '../../../src/audit/types';
import type { SourcePr } from './types';

/** Which search tier surfaced a PR (pre-registration amendment 3). The
 *  control arm is the unchanged per-vendor sample; the thin-review arm
 *  adds server-side review-thinness qualifiers plus local confirmation
 *  of author-merge and zero review comments. */
export type FetchArm = 'per-vendor-control' | 'thin-review';

/** Per-PR context features recorded in every funnel record from
 *  amendment 3 onward. Recorded for analysis, never filtered on (except
 *  the thin arm's two confirmation checks). Null means the source field
 *  or the one cheap extra API call was unavailable. */
export interface PrContextFeatures {
  repoStars: number;
  contributorCount: number | null;
  reviewCount: number | null;
  reviewCommentCount: number;
  openToMergeHours: number | null;
  mergedByAuthor: boolean | null;
}

/** One agent-attributed PR. `agent` is the fingerprinter's verdict from
 *  the PR's real metadata; `searchVendor` records which vendor query
 *  surfaced it (the two can differ when one agent co-authors another's
 *  PR; the fingerprinter's verdict wins). `arm` and `context` exist on
 *  every entry the two-arm fetcher writes (amendment 3); they are absent
 *  on older sources files and on entries other miners produce. */
export interface AgentSourcePr extends SourcePr {
  agent: AuditAgentAttribution;
  searchVendor: string;
  arm?: FetchArm;
  context?: PrContextFeatures;
}

/** The committed record of the fetch, reproducible like the other
 *  corpora: the exact queries, caps, band, and what was dropped. */
export interface AgentSourcesFile {
  fetchedAt: string;
  queries: string[];
  perVendorCap: number;
  lineBand: { min: number; max: number };
  skipped: Array<{ vendor: string; reason: string; count: number }>;
  prs: AgentSourcePr[];
}
