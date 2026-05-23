// Reads a v10 audit ledger file and projects it into the shape the
// CycloneDX-ML and SPDX-AI emitters consume. Kept independent of the
// emitters so changes to AIBOM specs don't ripple into ledger code.

import { readEntries } from '../../ledger/ledger';
import { SwarmError } from '../../errors';
import type {
  LedgerEntry,
  PrAuditStartedEntry,
  PrAuditFindingEntry,
  PrAuditCompletedEntry,
  LedgerAgentAttribution,
} from '../../ledger/types';

export interface AuditLedgerSummary {
  runId: string;
  started: PrAuditStartedEntry;
  findings: PrAuditFindingEntry[];
  completed: PrAuditCompletedEntry;
  agent?: LedgerAgentAttribution;
  generatedAt: string;
}

export function readAuditLedger(filePath: string): AuditLedgerSummary {
  const entries = readEntries(filePath);
  if (entries.length === 0) {
    throw new SwarmError(`audit ledger ${filePath} is empty`, 'AIBOM_LEDGER_EMPTY', {
      remediation: 'Try: re-run `swarm audit` to produce a ledger',
    });
  }
  const started = entries.find((e): e is PrAuditStartedEntry => e.type === 'pr-audit-started');
  const completed = entries.find((e): e is PrAuditCompletedEntry => e.type === 'pr-audit-completed');
  if (started === undefined || completed === undefined) {
    throw new SwarmError(
      `audit ledger ${filePath} is missing pr-audit-started / pr-audit-completed entries`,
      'AIBOM_LEDGER_INCOMPLETE',
      { remediation: 'Try: regenerate the ledger by re-running `swarm audit`' },
    );
  }
  const findings = entries.filter((e): e is PrAuditFindingEntry => e.type === 'pr-audit-finding');
  const summary: AuditLedgerSummary = {
    runId: started.runId,
    started,
    findings,
    completed,
    generatedAt: completed.ts,
  };
  const agent = pickAgent(entries);
  if (agent !== undefined) summary.agent = agent;
  return summary;
}

function pickAgent(entries: readonly LedgerEntry[]): LedgerAgentAttribution | undefined {
  for (const e of entries) {
    if (e.aiAgent !== undefined) return e.aiAgent;
  }
  return undefined;
}
