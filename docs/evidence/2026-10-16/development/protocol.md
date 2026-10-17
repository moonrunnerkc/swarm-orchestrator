# Development launches of 2026-10-16: the protocol, registered before launching

Written before the first launch below. These are development records on exposed tasks. Nothing
here is comparative evidence, and none of it pools with a scored cohort.

## Allowance and instrument

- At most 8 model-powered launches and 60 agent-minutes, every planner, worker and repair call
  counted.
- Swarm only.
- One local model and server, the same for every launch: Ollama 0.32.14 at
  `http://127.0.0.1:11434/v1`, `qwen3.6:35b-a3b`, thinking off. These are the settings the
  2026-10-16 comparison used.
- One launch at a time.
- Each launch runs through the proved comparison launcher (`scripts/comparison/run.mjs`) under a
  manifest frozen by `scripts/pilot/manifest.mjs --set 2026-10-16`:
  - a ten-minute deadline;
  - the 8,000,000-token allowance;
  - the product limits named in the manifest;
  - Swarm's workflow flags pinned in `pins.swarmFlags`.
- Build: `51c3ba489` (`~/.cache/swarm-comparison/tools/swarm-51c3ba489`).
- Scoring is the frozen task's hidden oracle. For mime, scoring also includes the 113-case audit in
  [../comparison/correctness-amendment/](../comparison/correctness-amendment/README.md), run on
  the delivered patch afterwards.

## Question 1: does the concise worker prompt cut cost without losing delivery?

- **Cells:**
  - `mime-bugfix-gettype-line-terminators-dev` and `pako-refactor-options-default-param-dev`;
  - once with the default prompt (`pins.swarmFlags` empty);
  - once with `--prompt-profile concise`;
  - four launches in all.
- **Measured:**
  - delivery (Swarm's exit 0 and the hidden oracle's pass);
  - total and input tokens;
  - model calls;
  - agent wall time.
- **Rule:** concise becomes the configuration of any later cohort only if it delivers every task
  the default delivers and uses at least 20 per cent fewer tokens on each. Otherwise the default
  stays. One launch per cell is a signal about this model on these two tasks, not an estimate of
  an effect.

## Question 2: do planned checks find and repair what the frozen checks missed?

- **Cell:** `mime-bugfix-gettype-line-terminators-dev-plan`, once, with `--plan-checks` and the
  prompt profile Question 1 selects.
- **Isolation:** the planner reads the task text and the repository with read-only tools. It is
  never shown the audit, its counterexamples, the upstream commit or either retained patch, and
  no production prompt names any of them.
- **Reported as autonomous discovery** only if an admitted planned check covers a line-terminator
  case outside the visible check and the frozen oracle (a terminator before an extension-only
  tail, a leading terminator, or more than one terminator), and only if that check rejects at
  least one of the two retained patches when run on them afterwards.
- **Reported as autonomous repair** only if such a check failed on a candidate during the run, a
  repair attempt followed, and the delivered patch passes it. A delivered patch that passes the
  audit with no such failure on the way is a first-attempt result, not a repair.
- Anything else is reported as what it was.

## Reserve

Three launches are held for a defect that invalidates a launch above (a broken endpoint, launcher
or scorer). They are never used for a better score.

## Results

Recorded in [README.md](README.md) after the launches; this file is not edited after the first launch.
