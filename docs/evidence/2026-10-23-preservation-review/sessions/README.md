# Preservation and review stage sessions

- `preservation-review-sessions.tar.xz` (9,287,728 bytes, sha256
  `1cfe7527884be174714c19639546b18226261cb86b34ecf2da86f69f5068f40a`) holds the study root
  `~/.cache/swarm-study-2026-10-23c` without its canary file. It covers the development study, the
  fresh block (with both superseded freezes, their preflight records and the stopped first
  launch), and both confirmation rounds:
  - every Swarm session ledger and its blobs;
  - aider and OpenCode streams and every command log;
  - the sealed hidden verdicts and supplemental scores;
  - the frozen configs, manifests and harness lockfile inputs.
- `preservation-review-heldout.tar.xz` (144,116 bytes, sha256
  `4d70fbcf1f96ade774c1c354afea170a0ffe0ce2d4593aa8671403bfb3e8201e`) holds the fresh block's
  held-out root `~/.cache/swarm-heldout-2026-10-23c`: the sealed evaluators, references and
  controls, their validation log, exposure scans, and the evaluator author's scripts and work
  notes. It is released after the block.

Both are kept on this branch so the main tree holds its weight headroom.
