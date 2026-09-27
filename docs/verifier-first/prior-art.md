# Prior art: what swarm-verify does that existing tools do, and do not

Written 2026-09-27 for the verifier-first campaign. Each row states what a category of tool
establishes about a change, as those tools document themselves. Nothing here is a measurement
of any other tool; the comparisons that measure are registered in
[comparison-protocol.md](comparison-protocol.md), and a claim of superiority is made nowhere
in this repository until one of them has run.

| Establishes | Plain CI (the repository's own suite in a hosted runner) | Coverage gates (a threshold on line or branch coverage) | Mutation testing (Stryker, mutmut, PIT) | LLM review bots (a model reads the diff and comments) | Held-out evaluation suites (SWE-bench style hidden tests) | Signed provenance (SLSA, Sigstore attestations of a build) | swarm-verify |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The suite passed on this exact head, in a fresh environment | yes, on the runner's environment | no (reads a report) | no (reads a report) | no | yes, for the benchmark's tasks | no | yes: fresh checkout of the exact base and head, dependencies from the lockfile with install scripts off, network off during the checks |
| A failure is attributed to the patch and not inherited from the base | no | no | no | sometimes, by reading | n/a | no | yes: a base control runs the same checks at the base commit and names a failure the base already had as inherited |
| The change's own lines were executed by something | no | partly: a threshold, not the changed lines | partly: mutants on covered lines | no | no | no | yes: changed-line coverage from a harness-named lcov, and mutants on the changed lines with the suite as witness; unmeasured is named as unmeasured |
| A stated requirement was met, apart from the suite | no | no | no | a reading, not an execution | yes, by the benchmark's hidden tests | no | with a requirement contract: challenges run a base control, mutations and sealed fixtures per requirement; without one, task correctness is reported as unmeasured and never as a pass |
| The verdict can be checked later by someone who was not there | logs, mutable and expiring | a number in a dashboard | a report | a comment | a leaderboard entry | yes, for the artifact's origin | yes: an append-only hash-chained bundle with its own dependency-free verifier and re-derivation script; one changed byte is refused with the broken link named |
| The verdict is bound to a signer and a head | the runner's identity, implicitly | no | no | no | no | yes | yes: the verdict document is signed as a GitHub artifact attestation, verified with `gh attestation verify`, and the one comment is bound to the head |
| No model is consulted for the verdict | yes | yes | yes | no: the verdict is the model's | yes | yes | yes: `check`, `ci`, `verify`, the Action, the hook and the MCP server make no model call; the coding agent is a separate, beta, product |
| Tamper resistance of the evidence | none beyond the host's | none | none | none | none | strong for the signed artifact | strong for the bundle; the signer's trust is a separate question, answered outside the bundle |

What the others do that swarm-verify does not: mutation-testing tools run every mutant of a
codebase, not only the changed lines; coverage gates enforce a whole-repository number; review
bots read intent and style; benchmark suites establish task truth for their own tasks with
human-written hidden tests; provenance frameworks describe how an artifact was built. None of
these is claimed here. A requirement-level verdict in swarm-verify needs a contract someone
wrote, and the study of AI-authored pull requests establishes task truth by a held-back check
written by a reviewer role, which is the closest this repository comes to a hidden test.
