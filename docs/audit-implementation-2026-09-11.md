# Audit implementation, 11 September 2026

This change implements the audit's correctness repairs and adds campaign, acceptance-contract,
security-observer and first-run study infrastructure. It does **not** complete the seven empirical
roadmap claims. Independent submissions, a frozen strongest-baseline comparison, sufficient
held-out observations, backend coverage and actual new users remain external requirements.
No new dependencies were added. No scheduler automation was added without a measured benefit.

The source plan and original observations are preserved at
`/private/tmp/swarm-audit-2026-09-10/report.md`. Implementation scopes, amendments, command logs
and fresh reproductions are retained separately at
`/private/tmp/swarm-implementation-2026-09-11/`. These local paths are machine-specific evidence,
not published campaign results.

## Delivery map

| Change | Implemented behavior | Evidence and remaining work |
| --- | --- | --- |
| 1. Verification | The CLI runs installed verification and re-derivation code. Ledger, blob, inventory, manifest, signer and criteria defects refuse verification. Bundle-local executable code has no authority. | Actual CLI tampering reproduction now exits 1; valid baseline exits 0. Historical cited bundles remain in the gate checks. |
| 2. Assessment | Agent, standalone gates, JSON, CLI, TUI and reward paths use the recorded assessment, including lifecycle, final base ratchet and blocking vacuous bonds. Integrity and signer trust remain separate questions. | The deleted-test fixture reports green false, displayed acceptable false and aborted administrative state. Its intact evidence verifies. |
| 3. Literal edits | Replacement text remains literal, including replacement tokens, Unicode and newlines. | Colocated file-tool regressions and the original price replacement probe. |
| 4. Budgets and context | Complete tool-message groups, tool arguments and schemas count toward context. Retries spend one token budget and deadline. Nonretryable provider failures stop; SDK retries are disabled and compatibility fallback attempts are recorded. | The original token probe reports 16,419. Its clock jumps in 60 ms increments, so the 100 ms case stops at the observed 120 ms crossing after two calls, with max-wall-time; it no longer reports completion at 180 ms. A real abort-ignoring model fixture also exercises deadline cancellation. Unknown billed usage remains unknown. |
| 5. Execution lifecycle | Tools, gate runners, independent verification and merge checks carry cancellation and backend selection. Container identities are recorded before creation, forcibly removed and checked absent. Controlled network probes retain unknown. | Real Docker fixtures cover detached children on normal exit, timeout, cancellation and SIGKILL of the harness followed by repair. Podman and nerdctl have not been validated in this change. Strict report channels that cannot be carried remain not measured. |
| 6. Attestation | DSSE v4 signs raw protocol bytes and binds full raw patch, run spec, source, chain and assessment. Malformed attestations are invalid. Truncated or scrubbed patch bodies cannot silently acquire raw patch attestation. | Independent crypto verification over assembled DSSE bytes passes. Historical v3 has an explicit compatibility reader. |
| 7. Recovery | An append-only JSONL journal replaces active SQLite writes. Real tool intents/outcomes populate steps. Valid session reopening continues the chain and restores payloads. Resume enters the normal execution path with original policy and remaining budget. Ambiguous effects and unknown provider usage refuse automatic replay. | Ledger reopening, stale writer, torn append, administrative crash and real runtime-repair tests. The read-only legacy importer preserves old bytes, refuses conflicting identities, and marks old bookkeeping as requiring reconciliation. Partial imports require explicit reconciliation. |
| 8. Routing | Default routing requires explicit experimental authority or an evaluated production policy before learned selection. Production checks a matching held-out protocol and disallows untried arms. | The original 20-reward probe keeps the measured calibration model. No qualifying held-out evaluation has been supplied or created. |
| 9. Campaigns | Protocols freeze population, identities, arms, implementation digests, budgets, order, stopping, baseline and interval. Dispatch invokes separate frozen implementations. All launches, unknown outcomes and cleanup failures remain visible. Oracle identities deduplicate and challenge reports show valid acceptance alongside refusal. | Synthetic campaign tests and explicit external-driver support in the pilot script. Admission provenance, strongest-baseline development selection, confirmatory sample size and the actual paired campaign are unfinished. The historical pilot does not become confirmatory evidence. |
| 10. Required obligations | External artifacts and predetermined reference/control patches are hashed and checked in fresh checkouts. Each requirement is accepted, rejected, unjudged or not applicable. The named certification policy requires all applicable required obligations. CI exports evidence on execution failures too. | A missing upper-bound requirement is rejected despite a passing old suite. The resulting bundle verifies and re-derives the controlled TAP rule. Independent authorship and requirement completeness still require external review. |
| 11. Security and daemons | A declarative corpus runner freezes attack provenance, capabilities, lifecycles and backend matrix, requires functionality controls, retains unavailable cases, and stops on unknown cleanup. | Maintainer regressions and the Docker lifecycle observations above. No independent attack engagement, complete lifecycle race campaign or all-backend corpus has occurred. |
| 12. First run | Command definitions drive help and packed behavioral tests. CI is extracted from the main handler. Notes appear immediately in the TUI transcript. Keychain commands have a timeout. A deterministic study fixture and consented milestone recorder are available. | Every packaged command meets its expected exit and diagnostic contract. No genuinely new user has been observed; cohort and comprehension claims remain unmeasured. |
| 13. Performance | Component transcripts reuse content-addressed prefixes and reconstruct exact prompts. Legacy prompt records still replay. Reads support ranges and byte limits; search bounds scanned bytes, paths and results and terminates regex workers at deadlines. | A growing-history fixture stores less than one tenth of the inline comparison bytes, with exact reconstruction. This is a fixture storage measurement, not a repository-wide throughput claim. |

## Compatibility and limits

The SQLite module appears only in the historical read-only importer and its fixture test. The
active administrative store is JSONL; ADR 0007 is explicitly superseded. Stop old clients before
migration. Do not treat a migration marker or an old completed step as proof that an external
effect completed. Journals and ledgers refuse incomplete tails rather than truncating evidence.
An unresolved writer lock requires reconciliation; it is not permission to delete an unknown
process or overwrite history.

The runtime client reads its own host configuration, while commands inside the boundary receive
a separately built environment. Requested containment is measured, not presumed. Host process
groups cannot guarantee absence of arbitrary daemonized descendants. Kernel-bound runtime
cleanup after abrupt harness death is a repair operation, not an immediate guarantee. The finite
Docker fixtures do not establish comprehensive security. Existing known-pattern scrubbing and
lexical-policy residuals remain as named in the build guide.

New CI contracts use controlled Node tests and fresh reference, counterexample and candidate
checkouts. A trusted contract package is supplied with `swarm ci --contract <package.json>`.
The package contains `contract`, `artifacts` keyed by content digest, and `patches` keyed by raw
patch digest. Backend selection uses `--isolation <runtime[:image]>`; an unsupported working
path or report channel is unavailable rather than silently executed on the host. Dependency
preparation in the historical pilot script remains a separately authorized host phase; it is
outside any isolated execution claim made for the later task and verification commands.

The paired interval is a conservative finite-sample bound for independent repository pairs,
using differences in [-1, 1]. It keeps uncertainty at all-success boundaries. It does not replace
power planning, independence review or an independent statistical implementation check. The
underlying reference is [Hoeffding, 1963](https://www.tandfonline.com/doi/abs/10.1080/01621459.1963.10500830).

## External completion requirements

Before claiming the seven roadmap items complete, supply independently admitted and immutable
challenge identities and requirement contracts; freeze a current build, verifier, strongest
baseline and sufficiently powered protocol; run all scheduled ordinary and adversarial cases;
retain every crash, unknown and infrastructure failure; execute the supported backend security
and teardown matrix with independent observers; and conduct formative and validation studies
with fresh, consented participants and a silent independent observer. The observer script records
observations and cannot substitute for those people.

## Remaining work, in order

1. **Prepare the test cases.** Reuse the historical cases for development. Ask people who did
   not build the tool to supply and review fresh tasks, complete acceptance checks and attacks.
   Check that each acceptance check accepts a correct fix and rejects a known incomplete fix.
   Give every case a permanent identity and keep the final evaluation cases out of development.
2. **Set the rules before testing.** Choose the release to test, task population, budgets,
   success rules, sample size and stopping rule. Pick the strongest competing tool on separate
   practice tasks, then freeze its version and settings. Have the statistical method reviewed.
3. **Measure incorrect success reports.** Run the frozen ordinary and adversarial cases.
   Record every launch, including crashes and unavailable checks. Report how often the tool
   accepts correct work and how often it incorrectly accepts broken or incomplete work, with
   uncertainty. Repeating a task does not make it a new independent case.
4. **Compare against the strongest alternative.** Give both tools the same new tasks and
   comparable budgets. Use independent acceptance checks. Measure correctness, time and cost,
   and test the allowed quality gap chosen in step 2. Keep learned model routing disabled by
   default until a matching evaluation supports it.
5. **Finish security and cleanup testing.** Have independent attackers test the supported
   execution backends, including Podman and nerdctl if they remain supported. Check file and
   network escapes and confirm ordinary work still succeeds. Check for surviving processes
   after success, failure, cancellation, abrupt harness death and recovery. Fix failures and
   record which guarantees were actually tested.
6. **Watch new users complete their first task.** Recruit consenting people who have never
   used the tool. First observe where they get stuck and improve the workflow. Then use a
   separate group for the final study, with a silent observer. Record total time, help needed,
   failures and whether they understand verification. Test the under-ten-minute claim.
7. **Fix what those runs uncover and publish the evidence.** Add regression tests, rerun the
   required checks, and repeat affected evaluations under a newly frozen version when needed.
   Publish the results and remaining limits. Close each roadmap item only when its evidence
   meets the rules set beforehand.

### Existing inputs located in the project

- `redteam/loop/state/lap-accounting.jsonl`: one driver-run lap and six human-driven passes,
  already used in development.
- `campaign/pr-tasks/scored.attack.json`: 18 historical attack runs, including two recorded
  false greens. The patches are under `campaign/pr-tasks/patches-attack/`.
- `campaign/pr-tasks/scored.json`: 94 historical task rows across 14 repositories. Seventy-nine
  share one harness version; other rows have different or missing versions. Do not pool these
  into a rate for the repaired build.
- `docs/evidence/2026-09-04/real-repos/README.md`: a three-task, eighteen-run baseline pilot.
- `campaign/eval/summary.json`: a two-arm pilot with 20 cases and three seeds per case.
- `docs/first-run-script.md`: the study procedure. No consented participant observations were
  found in the project search.

These materials support preparation and regression testing. The search did not locate an
independently admitted current-build campaign or a qualifying frozen strongest-baseline
comparison. Authorship statements in historical files were not independently authenticated.
