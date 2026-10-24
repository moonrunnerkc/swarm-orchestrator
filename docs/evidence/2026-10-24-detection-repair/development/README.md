# Development set: retained candidates that contain defects, and correct controls

This is development evidence. Every candidate below is a patch a launch of an earlier study
delivered. It is retained by digest and replayed as a run's first attempt
(`starting-candidate-v1`). None of it is a fresh result, and none of the tasks is unseen.

## Cases

[`development-set.json`](development-set.json) lists each patch with its digest and why it was
chosen.

| Case | Task (repository, type) | Candidate | What is wrong with it |
| --- | --- | --- | --- |
| D1 | ufo, feature | October 24 confirmation, `swarm` | Rebuilds `file:///C:/x?...` as given, not as `withQuery` does, and asks the predicate about the first key twice (the traced false accept) |
| D2 | ufo, feature | October 23 confirmation 2, `swarm-control` | Keeps the `?` of `/foo?` where `withQuery` drops it |
| D3 | ufo, feature | October 23 confirmation 2, `swarm` | Drops a valueless key (`...&y`) |
| D4 | ufo, bug fix | October 23 confirmation 2, `swarm-control` | Changes `withBase` where the base already ends at a boundary, which the task keeps |
| D5 | svgo, bug fix | October 23 development, `swarm` | Keeps a namespaced SVG anchor's executable link |
| D6 | p-limit, bug fix | October 23 development, `swarm` | Misses the requested queue behaviour |
| C1 | ufo, feature | October 24 confirmation, `swarm-control` | Nothing: strictly complete |
| C2 | ufo, bug fix | October 23 confirmation 2, `swarm` | Nothing. It changes `withoutBase("/admin-dashboard", "/admin")` from `"/-dashboard"`, as the task asks, which a plain comparison with the base calls a regression |
| C3 | p-limit, bug fix | October 23 development, `swarm-control` | Nothing: strictly complete |

**Two artifacts removed before replay.** Four patches carried edits that came from the old
runner, not from the candidate. Each was removed, and both the original and the replayed digest
are recorded in `derived.json` beside the inputs:
- `package-lock.json` in the two ufo bug-fix patches: npm pruning extraneous entries during
  install.
- `README.md` in two ufo feature patches: automd output from the `build` gate, the side effect
  corrected on October 24.

## Independent validation

[`validate-candidates.mjs`](validate-candidates.mjs) judges each replayed patch with its task's
own sealed evaluator, on a fresh clone of the base. It runs apart from the product and ran only
on the evaluator's side. It did not assume an earlier pass or fail.
[`validation.json`](validation.json):
- D1 to D3 fail the requested-behaviour check;
- D4 fails the kept-behaviour check;
- D5 and D6 fail their hidden tests;
- C1 to C3 pass every hidden check.

## What the reviewing and repairing model receives

Only what an ordinary run gives it:
- the task text;
- the workspace with the candidate in it;
- the run's obligations;
- what the run's own checks reported.

The candidates' provenance, the fault descriptions above, the evaluator files, the reference
patches and the expected fixes are under the study's protected roots, which the launch sandbox
denies. They appear in no prompt.
