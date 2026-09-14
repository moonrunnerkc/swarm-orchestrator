# Detailed engineering invariant rationale

The complete prior agent instructions are preserved with their original bytes in the existing
lossless UTF-8 file-map archive format. This retains the detailed incident narratives and
regression constraints without duplicating them in both automatically loaded agent files.
The concise active policy is `docs/engineering-policy.md`; its detailed security and evidence
mechanics continue to refer to this preserved text. The approved adaptive product revisions
were already present in this snapshot.

Source: `AGENTS.md` at `b5f32aaafe7cb4b88e6be288f9cb0bbed565f04d`, 25,878 bytes.
See the [source inventory](agent-policy-2026-09-13/inventory.json) and
[archive manifest](agent-policy-2026-09-13/archive-manifest.json).

Restore it offline with:

```sh
node scripts/local-campaign/archive.mjs docs/history/agent-policy-2026-09-13
```

The command reports an owner-only temporary directory containing the exact original
`AGENTS.md` and its inventory. Read that restored file for the detailed invariant, then remove
the reported temporary directory when finished. The unpacker checks the compressed digest,
expanded size and safe paths. No Git history or evidence ledger was rewritten.
