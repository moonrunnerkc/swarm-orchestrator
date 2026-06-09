// Shapes for the agent corpus: merged PRs the shipped fingerprinter
// attributes to an AI coding agent. Mirrors SourcePr/SourcesFile so the
// audit and arbiter stages can treat the corpus like the clean one.

import type { AuditAgentAttribution } from '../../../src/audit/types';
import type { SourcePr } from './types';

/** One agent-attributed PR. `agent` is the fingerprinter's verdict from
 *  the PR's real metadata; `searchVendor` records which vendor query
 *  surfaced it (the two can differ when one agent co-authors another's
 *  PR; the fingerprinter's verdict wins). */
export interface AgentSourcePr extends SourcePr {
  agent: AuditAgentAttribution;
  searchVendor: string;
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
