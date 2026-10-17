# Planned checks, live: protocol for the seeded demonstrations

Registered on 2026-10-17 before the first model-powered launch of this assignment. Results go in
[README.md](README.md). This file is not edited after the first launch, except to append the
ablation's section before that cohort starts.

## Status

These are **development records on exposed tasks**. The mime and node-tar outcomes, the mime
audit's counterexamples and the node-tar failure are known to the people developing Swarm, and
both tasks are historical public changes that may be in the model's training data. Nothing here
is fresh or comparative evidence.

## Allowance and instrument

- **Time:** at most 120 agent-minutes over every model-powered launch of the assignment, failed
  ones included, and a hard 15-minute end-to-end limit per launch.
- **Tokens:** 8,000,000 per launch, the product's own native cap, charged for planning, its
  revision, implementation, repair and final verification alike.
- **Counting:** every attempted launch is counted. Deterministic work (scripted rehearsals,
  validation, builds) is reported apart.
- **Model and server:** Ollama 0.32.14 at `http://127.0.0.1:11434/v1`, `qwen3.6:35b-a3b`, thinking
  off (Swarm sends the three spellings it always sends), 8192 output tokens per call. These are
  the settings of the 2026-10-16 launches. One model resident, one request at a time, one launch
  at a time.
- **Build:** a clean export of a commit on `feat/planned-check-live-repair`, installed and built
  under `~/.cache/swarm-comparison/tools/swarm-<commit>`. Each record names its build.
- **Workspace:** prepared as the comparison launcher prepares it (`scripts/comparison/workspace.mjs`):
  the original base cloned from the local mirror, the visible check committed, `npm ci
  --ignore-scripts`, the frozen `swarm.toml` gates (mime's lint advisory, as before), a private
  `HOME` per launch.

## The two cases

| | mime | node-tar |
| --- | --- | --- |
| task | `mime-bugfix-gettype-line-terminators`, text verbatim from `scripts/pilot/tasks-2026-10-15.mjs` | `tar-bugfix-negative-size`, text verbatim from `scripts/pilot/tasks-2026-10-16.mjs` |
| original base | `953ae3ebc59c387064f3760b73085eff6760a7f6` | `e02a4e9e013c4be95302e2eb2047a942b883c27b` |
| upstream (task-compliant control) | `d7871f3bac120df5e4776e7c395b39d0d8e7b562` | `9e78bf058b2c22dd4d52e00d8922d5c06fc2f7b5` |
| retained faulty patch | Swarm's 2026-10-16 stage A patch (terminators read as separators) | Swarm's 2026-10-16 repetition 2 (drops negative `uid`, `dev`, `ino`, `nlink`) |
| further compliant controls | none: OpenCode's mime patch is faulty too | Swarm repetition 1, OpenCode repetitions 1 and 2, where the expanded audit accepts them |
| evaluator | the frozen oracle plus [audits/mime-audit.mjs](audits/mime-audit.mjs) (113 cases of the task's rule) | the frozen oracle plus [audits/tar-audit.mjs](audits/tar-audit.mjs) |

The evaluators were validated before any launch ([validation/](validation/)): the base fails, the
upstream commit passes, and the retained faulty patch fails for the audit's reason. The first
tar audit wrongly expected `Pax.parse` to set `mode`; the upstream control exposed it, the base
does not set it either, and that field was removed before any launch.

## Seeded demonstration, one launch per case

[seeded/run.mjs](seeded/run.mjs) runs one ordinary `swarm --plan-checks` invocation on the original
base through a recording proxy:

- **A. Planning, live.** The planner gets only what the product gives it: the task text, the clean
  base workspace through read-only tools, the product's prompt and the configured preparation.
  It is never given the retained patch, the audits, the counterexamples, the upstream commit, the
  hidden checks or this brief.
- **B. Capture.** When the first implementation request arrives, planning and admission are over
  and no candidate exists. The proxy copies the planning chain's declarations and admission and
  the run chain's sealed contract before answering. No check is edited.
- **C. Admission** is the product's own. The evaluator then runs every admitted planned check
  against the base, the compliant controls and the faulty patch
  ([verify-checks.mjs](verify-checks.mjs)). The controls reach no model.
- **D. Seeded candidate (fault injection).** The first implementation loop only is answered by the
  proxy: `declare_file_set` and `write` of the files the retained faulty patch produces, then
  "Done.". The candidate is written through the product's tools onto the original base, so the
  diff is the real one, and the ordinary gate, repair and final verification follow.
- **E. Repair, live.** Every repair request goes to the model unchanged. No replacement code and no
  scripted repair answer are supplied.
- **F. Final verification** by the evaluator: the frozen oracle with the expanded audit, on the
  exact final patch.

Every request and response is recorded. The evaluator scans the non-model content of every
request (system, user and tool messages) for the retained patch's added lines, the upstream
commit's added lines, the audit files and the hidden check names, and records what it finds.
Content the model itself wrote earlier in the run (its own declared checks quoted back in failure
feedback) is reported as the model's, not as exposure.

### What counts

- **Live discovery** is reported only if a planned check the model generated, admitted by the
  product, rejects the retained faulty patch and accepts every compliant control. A check that
  rejects only through cases the planner was shown is not discovery; the planner is shown none.
- **Live repair** is reported only if such a check failed on the seeded candidate during the run, a
  repair attempt followed, and the final patch passes that check and the evaluator's full oracle.
- An implementation that is right without a planned check failing on the way is a first-attempt
  result, not a repair. A generated expectation that is wrong is kept as recorded and reported;
  the task, the controls and the evaluator are never changed to fit it.

### If it fails

The trace is read first. A demonstrated product defect is fixed with a regression test and the
case is launched again on the new build, as a new counted launch with its own record. A model
that writes an unhelpful check on a working product is an outcome, not a defect to rerun for.
