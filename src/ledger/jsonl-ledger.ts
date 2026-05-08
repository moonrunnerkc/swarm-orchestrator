/**
 * Phase 2 entry point for the JSONL ledger. Phase 4 upgraded the
 * implementation to a hash-chained ledger; the on-disk format is the same
 * (one JSON object per line) and the constructor signature is unchanged,
 * so this file remains the canonical import path for legacy call sites
 * while the new behaviour lives in `ledger.ts`.
 *
 * New code should import `HashChainedLedger` from `./ledger` directly.
 * Tests and back-compat call sites continue to import `JsonlLedger` from
 * here; the alias is intentional and will outlive the v8 transition.
 */

export {
  HashChainedLedger as JsonlLedger,
  readEntries,
  verifyChainEntries,
  verifyChainAt,
  ChainTamperedError,
  GENESIS_PREV_HASH,
  computeEntryHash,
  canonicalJson,
} from './ledger';
