# 0014. Rebuild as a small verifier and a plain agent loop on one implementation

**Status:** approved 2026-10-28, supersedes 0013 (in the archive named in [README.md](README.md))

## Context

By October 2026 the repository held about 97,000 non-test lines of TypeScript: a coding agent
with an adaptive controller, planned and generated checks, repair and review stages, parallel
workers, measured model selection, a terminal interface and twenty-five subcommands. Every
registered comparison against a plain agent loop on the same local model found no benefit
from that machinery, and several found the plain loop ahead. The parts that held up under
those comparisons were the verifier's: rerunning a project's real checks on a change in a
clean checkout, refusing changes that edit their own tests, and recording the result so that
anyone can check it offline.

## Decision

Two small products on one implementation.

1. **swarm-verify** is a source-agnostic verifier. It reruns a project's declared checks on a
   change in a clean checkout of the base, refuses changes that edit protected paths (tests,
   CI configuration, lockfiles, its own configuration) in the same patch as source, runs
   held-out checks the change's author never saw, measures changed-line coverage and one
   mutation pass, names what it could not measure, and emits a signed in-toto Statement in a
   DSSE envelope. `cosign verify-attestation` and a bundled dependency-free script both verify
   it.
2. **swarm run** is a single-bash-tool agent loop of at most 500 lines. Each turn the model
   emits one command; the harness runs it through the existing chokepoint and path policy and
   returns the output. When the model declares completion the verifier runs on the working
   tree; a failure goes back to the model verbatim. Nothing watches the agent mid-run.

Everything else is deleted. Research evidence, campaigns and scripts move to a private
archive repository with their paths unchanged. The command line is `run`, `verify`, `init`,
`ci` and `doctor`. A caps check holds the result small: no file over 300 lines, under 15,000
non-test lines in `src/`, no more test lines than source lines, at most six runtime
dependencies, five subcommands and three workflows.

The project's only measurements page is `docs/results.md`, written by the evaluation report under eval/ from a
frozen task list run against three arms (mini-SWE-agent, OpenCode and `swarm run`) and from a
tamper evaluation that measures the verifier's precision and recall on honest and cheating
patches.

## Consequences

- The invariants that make the verifier worth anything survive: model output is a claim and
  only harness-captured output is evidence; one execution chokepoint under the path policy;
  append-only, hash-chained evidence whose failed write aborts; and a verifier closure that
  cannot reach the agent, enforced at build time.
- The custom bundle format, its verifier and its historical bundles are retired. The tamper
  and clean-container demos are rebuilt against the DSSE format.
- Claims about the agent are limited to what `docs/results.md` measures.
- Decisions taken while carrying this out are listed in [DECISIONS.md](../DECISIONS.md), and
  work deliberately left undone in [FOLLOW-UPS.md](../FOLLOW-UPS.md).
