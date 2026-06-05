// Persist a block-trigger candidate to the hash-chained evidence ledger. Every
// candidate a run raises is recorded, whether or not it gates: the entry pins
// the evidence by sha256, records the reproduce command, and carries the policy
// decision (eligible) and whether it actually failed the merge (blocked). A
// blocked author can read the entry, run `reproduce`, and confirm the fact.

import type { HashChainedLedger } from '../../ledger/ledger';
import type { LedgerAgentAttribution, PrAuditBlockTriggerEntry } from '../../ledger/types';
import { blockTriggerEvidenceSha256 } from './block-triggers';
import type { BlockTrigger } from './block-trigger-types';

export interface BlockTriggerLedgerFlags {
  /** Whether this trigger's kind is block-eligible under the calibrated policy. */
  eligible: boolean;
  /** Whether the trigger actually failed the merge on this run. */
  blocked: boolean;
}

/**
 * Append a block-trigger candidate to the evidence ledger as a
 * `pr-audit-block-trigger` entry. Fingerprints the evidence (sha256 of its
 * canonical JSON) so a rendered verdict ties back to a replayable fact, and
 * localizes the entry (category, file, line) for the corroborated trigger,
 * which is the only kind with a single source line.
 *
 * @param ledger the run's hash-chained ledger
 * @param trigger the candidate to record
 * @param flags whether the trigger is eligible to gate and whether it blocked
 * @param aiAgent optional agent attribution to fold into the chain
 * @returns the appended ledger entry
 */
export function appendBlockTriggerEntry(
  ledger: HashChainedLedger,
  trigger: BlockTrigger,
  flags: BlockTriggerLedgerFlags,
  aiAgent?: LedgerAgentAttribution,
): PrAuditBlockTriggerEntry {
  const payload: Omit<
    PrAuditBlockTriggerEntry,
    'ts' | 'runId' | 'seq' | 'prevHash' | 'entryHash' | 'aiAgent'
  > = {
    type: 'pr-audit-block-trigger',
    trigger: trigger.kind,
    eligible: flags.eligible,
    blocked: flags.blocked,
    summary: trigger.summary,
    reproduce: trigger.reproduce,
    evidenceSha256: blockTriggerEvidenceSha256(trigger.evidence),
  };
  if (trigger.evidence.kind === 'corroborated-under-constraint') {
    (payload as PrAuditBlockTriggerEntry).category = trigger.evidence.category;
    (payload as PrAuditBlockTriggerEntry).file = trigger.evidence.file;
    (payload as PrAuditBlockTriggerEntry).line = trigger.evidence.line;
  }
  return ledger.append<PrAuditBlockTriggerEntry>(
    payload,
    aiAgent !== undefined ? { aiAgent } : undefined,
  );
}
