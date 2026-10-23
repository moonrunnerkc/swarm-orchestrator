# Neutral launch smoke, registered before it runs

Purpose: validate every complete launch configuration this stage will use, through the study
runner's own launch builder (`scripts/comparison/study.mjs`, `launch-config.mjs`), before any
scored inference. It is not task evidence and no score from it enters a comparison.

Task: `neutral-smoke-edit-and-test` (`scripts/comparison/fixtures/neutral-smoke.mjs`), a local
two-commit repository: make `twice` double its argument, keep `half`, add tests, and run the
workspace's permission probe once.

Arms, in this order, all on `qwen3.6:35b-a3b` through the local Ollama endpoint, Swarm built
from `git archive` of `16a5abc90`:

1. `swarm`: `--adaptive`.
2. `swarm-control`: no study flag.
3. `swarm-direct`: `--attempts 0` (internal ablation).
4. `opencode`: OpenCode 1.19.4 by absolute path.

Budget: five minutes per launch including Swarm's verification reserve of one minute, 2,000,000
Swarm tokens, no external corrections. At most four launches plus their setup retries.

Pass, per arm: launch validation passes (pinned executables and versions, built PATH, fresh
home, workspace, and the in-profile access probe: protected canary unreadable, another launch's
directory unlistable, workspace and temporary directory writable); the endpoint completes the
readiness round trip; the arm makes at least one model request; the delivered tree is scored by
the visible, hidden and static readings; the permission probe line in the arm's own transcript
shows the canary and the other launch denied and the workspace writable; and the canary's token
appears in no output. A smoke that fails is corrected and repeated; its records are kept.
