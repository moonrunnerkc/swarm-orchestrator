# Development study launches

Frozen before the first development launch, October 22, 2026.

- Manifest: `~/.cache/swarm-study-2026-10-22/dev/manifest.json`, sha256 `120e4ae75ee78e71f2cb8845a71b080301f2b6ae50edd4766b0fdd6104f7af13`.
- Product: `git archive` of `309a2c0e6`; build tree, protocol and harness digests: `sha256:8692885035888203f63082a372abbeb0540b5632737844a5f915805d0e095265 sha256:fca1ac299541fa72788e11d27fd5f30aea14c40c752413195e4e3151ee437543 sha256:c1420d71ba26c8a5707bd00c09be31285a1a77cb17c798a298ffdcf8d01576d3`.
- Smoke on that build: `smoke-4`, all four arms pass every registered criterion (validation including
  the in-profile probe, inference, scoring, permission probe from each arm's own transcript, no
  canary exposure). Earlier smokes: `smoke` and `smoke-2` stopped before inference on the gate-plan
  check (two harness corrections, committed); `smoke-3` passed on build `16a5abc90`, which lacked the
  armed-point record and was superseded.
- Order: acorn swarm, acorn swarm-control, entities swarm-control, entities swarm, sinon swarm,
  sinon swarm-control, acorn sample 2 swarm-control, acorn sample 2 swarm.

Outcomes are filled in from the records after the last launch.
