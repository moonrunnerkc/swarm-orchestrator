# Swarm Orchestrator: current evaluation and product recovery plan

Review date: October 31, 2026. Scope: the current default branches of both repositories, their packaging and release state, repository evidence, executed checks, and a concrete product overhaul plan.

**Recommendation: retain the small implementation, restore Swarm Orchestrator as the coding product, move ownership of verification into Swarm Verify, and make completion of the requested requirements drive execution and the final report.** The current rebuild reduced complexity substantially, but its acceptance rules obstruct ordinary engineering and can also accept work that did not perform the requested task.

The objective is a product Brad can use and inspect: more dependable completion, evidence that exposes unsupported claims and tampering, simple operation, efficient local inference, and little maintenance burden. A large comparative benchmark campaign is not a prerequisite. Broad superiority remains an aspiration until observed; the immediate release gate is a small, demanding set of real workflows and falsification checks.

## 1. What was inspected and executed

| Item | Pinned state |
| --- | --- |
| Swarm Orchestrator | `v13-main`, `5f1b5472bd40f1d6889e8f2304ce4f9361fb9086` |
| Swarm Verify repository | `main`, `71328695ef1cf8822c6f326e96e5d0888df72db4` |
| Local runtime | Linux, Node `24.22.1`, npm `11.9.0`, git `2.51.1` |
| Source package versions | `swarm-orchestrator@15.0.0`, embedded `swarm-verify@2.0.0` |
| npm `latest`, queried during review | `swarm-orchestrator@14.4.0`, `swarm-verify@1.3.1` |

I read the current product instructions, architecture decision, agent loop and model client, execution and evidence boundaries, verification pipeline, configuration, acceptance and reporting code, build scripts, release workflows, standalone distribution, and evaluation machinery. Fresh local clones were used. No product source was changed, committed, pushed, or published.

Executed results:

| Check | Observation |
| --- | --- |
| `npm ci` | Passed; built the agent distribution |
| `npm run gates` | Passed after fetching the release tags needed by historical changelog validation |
| Existing test suite | 296 tests passed in 33 files; final gates run took 8.57 seconds for the test phase on this machine |
| Complexity caps | 6,536 non-test TypeScript lines, 3,167 test lines, two runtime dependencies, five subcommands, three workflows |
| Standalone verifier build | Passed; 27 emitted JavaScript modules, build-time dependency boundary passed |
| Pack and separate install | Both tarballs installed into a fresh local prefix; both installed CLIs displayed help successfully |
| Package payload | Agent: 133,549 compressed bytes; verifier: 74,828 compressed bytes |
| Repository tamper suite | Reproduced 20 honest patches accepted and 24 cheating patches refused; zero verifier crashes |
| Published results regeneration | `renderPage()` exactly reproduced the committed `docs/results.md` |
| Additional behavior probes | Eleven controlled cases, detailed below; source and results included in the appendix |
| Current commit's GitHub CI | Successful [CI run](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/41010028470) |

A shallow checkout initially failed the documentation check because old release tags were absent. Fetching all tags referenced by the two changelogs resolved that failure. This is a contributor setup dependency, not an unresolved failure of the final reviewed tree.

**Limits:** the additional agent probes use scripted model replies to exercise actual execution, verification, signing, and stop behavior. They establish harness defects, not LLM coding ability or frequency of those defects in normal use. I did not run a new live-model comparison, test on Brad's Mac, independently validate every historical benchmark trajectory, or perform an exhaustive hostile-code security audit. Package smoke tests establish installation and startup, not the whole installed coding workflow.

## 2. Current product diagnosis

### The identity has inverted again

The current root [README][readme] is headed `swarm-verify`. [ADR 0014][adr] explicitly chooses two products on one implementation and makes `swarm run` a small loop judged only by the verifier. This is an intentional architectural decision, not a stray title.

The separate [Swarm Verify repository][verify-home] is a generated GitHub Action distribution pinned to npm `1.3.1`. Its README and `SOURCE.json` point back to the Orchestrator repository for implementation. Meanwhile, the newer verifier is still built from `swarm-orchestrator/src/verify` and `packages/swarm-verify`. The root package has no `swarm-verify` runtime dependency, and [`src/agent/run.ts`][agent-run] imports verifier modules through relative source paths.

**Required correction:** Swarm Orchestrator must own the coding workflow. Swarm Verify must own verification implementation and releases. The dependency should be visible in the installed package graph and exercised through a supported interface, not merely described in prose.

### The simplification itself is worth keeping

The current code is small, uses two runtime dependencies, has working tests, and has a comprehensible execution path. Keep the basic agent loop, captured command execution, environment construction, evidence hashing, standard attestations, and a standalone verifier with no model dependency.

Do not restore the former controller, framework, numerous commands, or research infrastructure wholesale. The problem is now missing or misaligned product behavior, not a need for another large architecture.

### Requirement completion is absent from acceptance

The [predicate schema][predicate] records checks, baseline results, held-out checks, protected paths, coverage, mutation, environment, and producer information. It has no requirement list, requirement-to-evidence mapping, or per-requirement completion status. The [agent loop][loop] converts verifier `pass` into `stop: verified`. The [CLI report][cli-run] prints that stop and verdict without establishing that the user's requested change occurred.

This is the central defect. Signing a regression check does not turn it into evidence that a feature was built.

## 3. Reproduced behavior that must change

All cases below ran against the pinned current source. Probe names correspond to the appendix output. Severity describes their effect on the intended product, not a formal security rating.

| Priority | Reproduction | Observed result | Required behavior |
| --- | --- | --- | --- |
| P0 | Ask for a new `double(n)` export; scripted model immediately declares completion; existing tests pass | `stop: verified`, verdict `pass`, empty diff, no `double` implementation | Explicitly establish the requested behavior or report it unverified. A legitimate already-satisfied task may pass only after checking that requirement |
| P0 | Repair `half(n)` correctly and add a negative-input regression test | Tests pass, changed line covered, mutant killed; verdict `fail` solely because the test changed with source | Permit normal engineering changes while protecting the authority of the acceptance checks |
| P0 | Change only the expected assertion from `half(4) == 2` to `half(4) == 4`, leaving the broken function intact | Verdict `pass` without sealed checks | A weakened candidate test must not replace the evidence of the requested behavior |
| P0 | Run `node --test` in an empty test directory | Verdict `pass`, zero tested behavior, uncovered source and surviving mutant | Zero collected tests cannot establish test success or task completion |
| P0 | Fix the requested behavior while an unrelated test already fails | Whole check becomes `pre-existing-failure`; verdict `unmeasured` | Separate the repaired requirement from the genuinely inherited failure |
| P0 | Introduce an additional regression into a suite that already fails | Also labeled `pre-existing-failure` and `unmeasured` | Recognize the new failing test; when parsing is unavailable, report an unresolved comparison rather than assert inheritance |
| P0 | Produce the correct edit on the last allowed agent step | `step-budget`, zero verifications, no attestation; a separate verification passes | Reserve final verification capacity and assess the delivered snapshot on every exit |
| P0 | Verify an incomplete tree, then make a correct final edit before the step limit | Final report retains the previous `unmeasured` verdict and an attestation whose patch digest does not match the final patch | Mark stale results unusable and verify the final snapshot, or explicitly report that final verification was unavailable |
| P0 | Change linked `node_modules` content between runs without changing source patch or lockfile | Verdict changes from `pass` to `fail`; environment digest stays identical and cached baseline is reused | Bind execution to reproducible dependencies; never treat this fingerprint as identifying an immutable environment |
| P1 | `.swarm/` is ignored; the agent reaches a second verification after its first attestation was written | `git add -A -- . :(exclude).swarm` throws an ignored-path error on git 2.51.1 | Repeated verification works in a repository that ignores generated Swarm output |
| P1 | Mutation rewrites a one-line function's return and drops its closing brace | Invalid JavaScript is recorded as a killed mutant | Distinguish invalid mutation, execution error, timeout, and genuine behavioral detection |

Root causes are concentrated in [protected-paths.ts][protected], [checks.ts][checks], [verify.ts][verify], [change.ts][change], [loop.ts][loop], and [mutation.ts][mutation]. These are repairable defects and policy errors. They do not justify replacing the entire codebase.

The mutation finding does not show that the original candidate was wrong. It shows that the reported strength of the test is overstated: a parser rejecting broken syntax is not evidence that an assertion detected incorrect behavior.

## 4. Other material findings

### Evidence is useful, but the assurance boundary is weaker than the desired promise

The current verifier signs a standard in-toto statement in a DSSE envelope. Its subjects bind the patch and the resulting tracked tree. That is useful and should remain.

However:

- The signed [predicate][predicate] does not bind the agent command ledger's final digest or a requirement-level completion report.
- The offline [checker][checker] validates signatures and requested subject digests. It prints the embedded verdict but does not enforce it or independently rederive requirement completion. Its documented exit zero means signature/subject validation succeeded, even for a signed failing verdict.
- Verification code runs as the same host user as candidate code. The project's own [verification documentation][verifying] says code can attack the judge report, baseline cache, sealed store, or installed verifier. The lexical command policy is not an isolation boundary.
- The sealed tests' runtime tripwire watches selected Node/Python behavior. It is not a general defense against arbitrary runner or same-process oracle manipulation.
- Submodules are excluded from the current tree digest and are not checked out for verification. They must remain explicitly unsupported until covered.

**Use the term tamper-evident evidence.** A signature detects changes relative to an independently trusted signing key; it cannot establish correct execution, comprehensive tests, or the absence of unobserved cheating. A public key delivered beside a bundle is not, by itself, an independently trusted identity.

### The agent omits basic workflow support

The code does not automatically load repository `AGENTS.md` or `CLAUDE.md`. [DECISIONS.md][decisions] records that instruction loading was dropped to meet the small loop's line target. A model might discover these files itself, but that is different from honoring them reliably.

[`cli-run.ts`][cli-run] requires a model and endpoint supplied by flags or configuration. There is no installed-model discovery, capacity check, measured selection, or automatic local escalation. The model client supports an OpenAI-compatible chat endpoint, which is a useful foundation, but not automatic model management.

The loop resends its growing message history, repeats the task and latest failure, has no context compaction, and checks its aggregate token limit only between calls. When usage is absent, its fallback estimates the messages before adding the current reply, so that reply is omitted from the estimate. Input tokens also consume budget even though the request's completion cap is calculated from the nominal remaining total. There is no single end-to-end wall-time budget in `run`.

The current run edits the user's workspace directly. The plan must handle pre-existing edits, interruption, ownership of new files, and a reviewable patch without overwriting unrelated work.

### Release and maintenance gaps affect usability

Both GitHub release jobs failed before npm publication:

- [Agent release job](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/41009689444).
- [Verifier release job](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/41009689239).

The agent job log shows four unresolved historical documentation paths at the tagged commit. The latest reviewed commit fixes those links and passes local gates, but those fixes are not evidence that an npm release happened. npm still reports 14.4.0 and 1.3.1. The separate Action repository still pins the old verifier.

The [CI workflow][ci] runs checks, typechecking, linting, and tests separately, omitting `npm run caps`, while release runs `npm run gates`. Use one canonical gate command so green CI means the same thing as a releasable tree.

The rule that test lines may not exceed production lines is a poor quality constraint. It can discourage exactly the boundary tests now missing. Keep strict types and focused modules, but measure unnecessary abstractions, dependency growth, runtime overhead, and behavior. Do not reward fewer useful tests or compressed source code.

### What the existing benchmark actually tells us

The [committed results][results] are reproducible from their JSONL rows: Swarm passes the benchmark's external checks on 14 of 30 tasks, mini-SWE-agent on 15, and OpenCode on 10. These are existing results, not fresh live launches from this review. The paired differences are not statistically significant in the repository's analysis.

More relevant to this plan: none of those 30 Swarm launches ended as `verified`. Fifteen ended before any verification; fifteen had an `unmeasured` final verifier result. The tasks cover 22 Astropy cases and eight Django cases, not the full feature/fix/refactor/upgrade product scope. Raw Harbor trajectories stay on the original runner rather than in the public results store.

The [evaluation runner][eval-run] pins an older OpenCode version to avoid a hang, and the mini-SWE-agent adapter installs an unpinned distribution. A recorded `commit` identifies the Swarm evaluation checkout, not necessarily the exact third-party agent version. These are limitations on comparative interpretation.

Retain these results as history. They should not dictate the next development cycle. The existing scheduled large evaluation should become manual until the product workflow works.

## 5. Product specification

The product promise should be:

> Give Swarm an engineering task. It makes the change, checks each requirement, repairs supported failures, and returns the patch with evidence of what is complete and what remains uncertain.

Features, fixes, refactors, and upgrades are all first-class work. Neither a feature label nor a file extension determines whether a change is suspicious.

The normal flow should require one task command. Proposed interface examples below describe the target, not existing behavior:

```sh
swarm run "Add a --json option to the status command and preserve the existing text output"
swarm run "Upgrade the HTTP client and update every affected call site" --local
swarm run "Extract the date parser without changing accepted inputs" --model auto
```

Auto mode discovers an available local runtime, selects a suitable installed model, loads relevant repository instructions, identifies checks, and starts. Routine choices are automatic. Ask only when a genuine requirement ambiguity, scope change, destructive action, or material new download needs the user's decision. Do not make writing a contract or configuration file a prerequisite to trying the agent.

The default screen should show the task, chosen model and reason, concise progress, and final requirement status. Evidence details remain available in the report. No control panel or sprawling terminal interface is necessary.

### Completion must be a structured result

Build one small requirement record from the user's request and explicit repository obligations. Retain the original wording, assign stable IDs, and distinguish explicit requirements from inferred assumptions. Show the interpretation briefly without demanding routine approval.

Each record needs:

| Field | Purpose |
| --- | --- |
| Requirement ID and wording | Preserve what was actually requested |
| Source and assumptions | Show user-provided scope separately from agent interpretation |
| Evidence references | Identify executed checks and observed artifacts, not model prose |
| Check origin and authority | Distinguish pre-existing checks, user-supplied acceptance, independently generated checks, and implementation-authored tests |
| Status | `satisfied`, `failed`, `unverified`, or `blocked` |
| Snapshot binding | Identify the precise candidate and environment measured |
| Limitation or next action | Explain unresolved evidence without hiding it |

A model may propose the mapping and checks; it cannot set a passing status. The verifier and final-report code derive statuses from captured results and declared policy. Another model's agreement is not execution evidence.

Generated tests can provide useful measured evidence. Report their origin and bounded scope. They do not become user-approved specifications merely because another model wrote them. For ambiguous or subjective requirements, retain the ambiguity or require a specific review rather than invent a machine-verifiable obligation.

Final overall state:

- **Complete under the recorded checks:** all required obligations are satisfied, no new regression is unresolved, evidence matches the delivered snapshot, and the declared execution policy was met.
- **Incomplete:** at least one requirement failed or remains unverified.
- **Blocked:** the environment, permissions, model, or required external prerequisite prevented completion.

Keep execution assurance and evidence integrity as separate fields. An explicitly permitted host run must say that its code was not isolated. A full evidence claim cannot silently degrade to a weaker execution mode.

The report must support all task types correctly. Bug fixes and new features often need a fail-before/pass-after witness. Refactors normally need preserved behavior plus evidence that the structural change occurred. Upgrades need resolved version and lockfile evidence, fresh dependency installation, and compatibility checks. A rule demanding a failing baseline for every requirement would incorrectly reject successful refactors.

## 6. Two repositories, one verification implementation

| Ownership | Swarm Orchestrator | Swarm Verify |
| --- | --- | --- |
| Primary purpose | Complete engineering tasks | Measure a candidate change against declared obligations and checks |
| Owns | Task interpretation, instructions, model selection, edit loop, repair, workspace/session handling, final user experience | Verification request/result schema, test-result normalization, protected checks, isolated execution, dependency provenance, attestations and evidence validation |
| Model dependency | Yes | None |
| Release | `swarm-orchestrator` with `swarm` CLI | `swarm-verify` library/CLI and its Action |
| Dependency direction | Declares an exact tested `swarm-verify` runtime version | Does not import, install, or require the coding agent |

Move the lean verifier implementation into `moonrunnerkc/swarm-verify`. Do not resurrect the full old verifier architecture. Audit older behavior for requirements and targeted fixes worth recovering, especially per-test baseline handling, container execution, and goal-contract semantics. Port small, tested behavior, not whole retired subsystems.

Expose a versioned public verification API and a machine-readable CLI result. The exact export is an implementation decision; existing internal `verifyChange` is a starting point, not currently a supported installed-package API. The contract must carry the immutable base/candidate, requirement definitions, check authorities, execution policy, and artifact destination. Results must include typed requirement outcomes, diagnostics, environment identity, and evidence references.

Only one component owns interpretation of verification outcomes. Swarm consumes the result to decide whether to repair or stop; it must not reimplement the acceptance predicate. Keep standalone verification of another agent's patch as a separate verifier use case.

Migrate using packed local artifacts in cross-repository tests, then a prerelease, then an exact dependency. Test that the installed agent uses the installed verifier. Delete the embedded verifier source and workspace package after parity checks pass. A temporary adapter must have a deletion condition; do not leave two implementations in parallel.

Preserve existing users through an explicit migration note and supported schema handling. Changed commands, exit codes, evidence format, and Action inputs require a versioned migration. Do not silently overwrite an old major version's semantics or move existing release tags.

## 7. Make evidence resist shortcuts without blocking legitimate work

### Protect the judge, not every editable test file

Replace the blanket source-plus-protected-path refusal with a distinction between **candidate artifacts** and **acceptance authority**.

Candidate artifacts may include source, tests, manifests, lockfiles, configuration, migrations, and documentation. Trusted acceptance commands, external requirement checks, baseline snapshots, policy, and signing material are controlled outside the candidate's writable environment.

Run the proposed candidate tests as useful additional evidence. Preserve the original regression obligations unless the task explicitly authorizes changing their behavior. A legitimate behavior change can supersede an old expectation, but the report must name that change and independently check the new expectation. It cannot quietly weaken an assertion.

For upgrades, prepare base and candidate dependencies separately from their respective lockfiles. For refactors that move test paths, compare behavior and recorded test identities rather than assuming every rename is removal. Do not restore all manifests and lockfiles to the base before judging the upgraded candidate.

### Establish one real execution boundary

Use an existing container runtime for the first supported isolated path. Reuse and simplify the existing/historical integration where suitable. Do not build a custom sandbox or a backend plugin framework.

The editing environment and the verifier's execution environment must be separate. Candidate code must not be able to write the verifier, signer, trusted reports, baseline cache, or acceptance policy. Export immutable inputs instead of sharing writable host git objects. Recheck candidate digests around verification; a check that rewrites the source invalidates that measurement. Do not mount the Docker socket, user's home, credentials, or writable host dependency directories into either workload.

Dependency acquisition is a separate, recorded setup stage using the pinned lockfile. Enable required registry access only there. Final verification runs with the network policy recorded and normally closed. A task that actually requires network interaction needs an explicit check policy; do not pretend an offline fixture proves a live integration.

Read-only tests in a container are still not a complete defense against code that tampers with an in-process test framework. Retain supported tripwires and use out-of-process or black-box acceptance checks for decisive observable behavior where feasible. Treat unsupported execution and oracle boundaries as limitations. Do not claim that containerization proves the absence of all cheating.

### Correct what gets measured

Start with result formats needed for the supported Node/TypeScript and Python workflows: Node test results and JUnit-style results from selected configured runners. Normalize test IDs, passes, failures, errors, skips, and collection count. Add an adapter only for an actual supported workflow, not every ecosystem at once.

Detect new failures, inherited failures, missing tests, and collection failures separately. Required checks have explicit identities: a missing report, skipped required test, or unavailable sealed check makes the associated obligation unverified or blocked, even when another command exits zero. Preserve flakiness as uncertainty with bounded reruns and recorded results. Unknown formats can still supply command execution evidence, but must not support a fabricated per-test regression conclusion.

Validate mutation syntax and execution before calling a mutant killed. Timeouts and runner crashes are distinct outcomes. Prefer a few relevant boundary or property checks over a whole mutation-testing platform. Coverage and mutation are evidence-strength diagnostics, not substitutes for requirement completion.

### Bind evidence to exactly what was delivered

Finalize once per immutable candidate snapshot, with:

- The original request, interpreted requirements, assumptions, and relevant instruction digests.
- Base commit, candidate patch and tree digests, dependency/environment identity, and tool/verifier versions.
- Actual commands, captured outputs or content-addressed log files, exit status, collection counts, and timeouts.
- Requirement-to-evidence mapping, regressions, blocked/unverified items, and execution-policy outcome.
- The final command-ledger digest and manifest of evidence artifacts, signed using the existing standard attestation machinery.

Keep keys and the authoritative evidence writer outside the candidate's reach. Separate identity trust from mathematical signature validity. An offline checker should validate artifact bindings and derive the declared completion state from the evidence schema; its output must distinguish integrity verification from task acceptance.

Invalidate the final status after any candidate edit. Recheck the digest immediately before delivery, with no intervening write access. External replay should install dependencies afresh and rerun checks when stronger verification is desired. Logs alone cannot replay side effects or recreate an undocumented environment.

## 8. A small agent loop that finishes work

Retain one implementation of the edit loop. Add a small explicit state record rather than a planner framework:

1. Read the task and applicable instructions; snapshot existing work and identify checks.
2. Record requirements and unresolved assumptions.
3. Edit and run relevant checks through the captured execution path.
4. Ask Swarm Verify to assess the current candidate.
5. Repair a specific supported failure while budget remains.
6. Finalize the exact delivered snapshot and render the requirement report.

Use one run budget covering model calls, commands, repair, review, and final verification. Reserve time for final checks before starting another optional edit. No new model call begins when the remaining allowance cannot support the request. Account for input and output separately, and distinguish reported usage from estimates.

Every exit path needs finalization: normal completion, step/token/time limit, provider error, cancellation, and interrupted check. If verification cannot finish, write an incomplete report tied to the final snapshot. An interruption must not erase the work or allow a previous passing attestation to describe later edits.

Run in a managed worktree by default, seeded with the explicitly included starting state. Preserve the user's staged and unstaged edits and record their boundary. Deliver a patch against that starting snapshot; offer application only after checking the target has not changed. Never reset unrelated user files. Session data needs only files, not a database.

Load root and applicable nested `AGENTS.md` instructions deterministically, with documented precedence and bounded context. Support `CLAUDE.md` compatibility only where appropriate and make conflicts explicit. Repository instructions are untrusted with respect to the supervisor's security policy; they cannot grant access to keys or redefine acceptance authority.

## 9. Automatic local models and efficient token use

“Best model for the task” must mean the most suitable available model under the user's hardware, quality, latency, privacy, and context constraints. It is not something a model name or parameter count can prove.

### First implementation

Support automatic discovery for Ollama plus the existing explicitly configured OpenAI-compatible endpoint. Avoid a general provider registry. Ollama's documented APIs expose installed models, model metadata, and running-model memory/context information: [model list](https://docs.ollama.com/api/tags), [model details](https://docs.ollama.com/api-reference/show-model-details), and [running models](https://docs.ollama.com/api/ps).

Selection procedure:

1. Respect an explicit user model selection. Otherwise inspect the configured local runtime and installed models.
2. Filter by actual runtime support, available memory, usable context, output/protocol behavior, and local-only requirements. Advertised model context is not the configured context, and model file size is not total memory demand; account for KV cache and operating-system headroom.
3. Run a small cached readiness probe: can the endpoint answer, follow the shell protocol, return usable output, and handle the configured context? A model-list response alone is insufficient.
4. Select one suitable installed model from a small local profile. Explain the reason in one line. With little evidence, call it a conservative default rather than an optimized choice.
5. Reassess after repository inspection or a reproducible lack of progress. Permit one escalation to a stronger eligible local model when the failure is model-related. A missing dependency or broken test environment is not a reason to buy more reasoning.
6. Record the choice, model digest, quantization, context, runtime, observed throughput, and escalation reason. Cache profiles by those identities; invalidate them when the runtime/model changes.

Brad's 64 GB Apple Silicon machine and 12 GB desktop GPU require separate profiles. Do not hard-code a model list from this review or assume performance transfers between those machines. Verify actual installed capacity during onboarding. If no suitable local model exists, explain the exact setup step. A large download or cloud fallback is not silently authorized by `auto`.

### Token efficiency comes from avoiding wasted work

Keep stable instructions and the task at the front of the context. Send relevant file excerpts, current requirements, the current diff, and compact failure details. Store full logs outside the prompt and retrieve the needed portion by evidence reference.

Compact old exploration only when context pressure justifies it. Preserve facts, file references, unresolved requirements, failed approaches, and the evidence that supports each summary. Do not repeatedly send full output or run a second model to summarize every trivial turn.

Stop unchanged command/output cycles. Reuse a baseline only when the candidate-independent environment is truly identified. Do not reuse a verdict after file, dependency, requirement, or policy changes.

Track **resources per completed task**, including failed attempts and escalation. Report input/output tokens, elapsed inference time, wall time, retries, and known monetary cost separately. Local tokens are not free of time or memory cost. A smaller model that needs repeated repairs may be less efficient than a stronger one.

## 10. Research worth applying, with limits

These are specific design inputs, not promises that papers' reported gains transfer to Swarm. The lightweight adaptations below are proposals to check on the product's own tasks.

| Source | What it supports | Small adaptation for Swarm | What to defer |
| --- | --- | --- | --- |
| [Rethinking Verification in Agent Harnesses, October 25, 2026](https://arxiv.org/html/2610.34577v1) | In its evaluated settings, separate review had a better accuracy/cost tradeoff than repeatedly reopening completion for more self-checking | One fresh-context review of the requested behavior and diff when checks leave a meaningful gap. Require a concrete finding, example, or executable challenge; verify before repair | Reviewer committees, unrestricted rounds, and treating model opinions as verdicts |
| [SWE-Router, June 2026](https://arxiv.org/html/2607.00053v1) | Intermediate exploration can inform routing more than the prompt alone; the implemented method uses a learned value head | Make one routing reassessment using observed repository scope and failure/progress signals | Training a router before collecting product data; claiming a hand-written rule inherits the paper's theorem |
| [SWE-Replay, January/February 2026](https://arxiv.org/abs/2601.22129) | Reusing earlier exploration can reduce repeated work relative to restarting every attempt | Preserve validated facts and the current patch when a retry is justified; discard unsupported assumptions | A trajectory archive and branching search engine |
| [Scaling Test-Time Compute for Agentic Coding, April 2026](https://arxiv.org/html/2604.16529v1) | Structured summaries can support selection and reuse across longer coding attempts | Use compact, evidence-linked handoffs after long runs or escalation | Recursive tournaments and candidate populations before a single dependable workflow |
| [mini-SWE-agent](https://github.com/SWE-agent/mini-swe-agent) | A minimal shell-centered agent is a serious engineering baseline | Preserve the simple loop and add only mechanisms tied to observed product failures | Rebuilding a framework because the project name contains “Swarm” |

The routing theorem concerns an ideal decision rule with informative signals. It does not prove that an approximate router, its exploration overhead, or a particular local model pair is better. The review paper's outcomes also depend on models and task distributions. An independent context is useful, but does not make two models' errors statistically independent.

Keep optional review disabled by default until a small product trial shows useful catches at acceptable cost. First fix the deterministic acceptance and evidence defects. More model calls cannot repair a broken acceptance definition.

## 11. Implementation sequence and exit criteria

Each phase should land in small reviewable commits with a working CLI. Resolve root causes found in the touched workflow; record unrelated issues explicitly instead of expanding into another rewrite. No phase is complete because its documentation says it is complete.

| Phase | Concrete work | Exit condition |
| --- | --- | --- |
| 0. Lock the product direction | Supersede ADR 0014's verifier-first ownership; update both instruction files, README, package descriptions and contribution rules; make the large nightly evaluation manual; retain historical evidence | Documentation consistently describes one coding agent consuming one standalone verifier. No repository rule still forbids necessary requirement handling or legitimate test changes |
| 1. Give Swarm Verify ownership | Move the lean verifier source/build/tests into its repository; define supported request/result schema and package exports; keep model code out; establish packed consumer tests | Verifier builds and works independently; Orchestrator consumes the package through its public boundary; duplicate embedded implementation is removed |
| 2. Repair verification semantics | Fix test-only weakening, zero collection, per-test regressions, allowed test/config changes, dependency identity, invalid mutants, and ignored-output repeat verification | The relevant audit probes become passing regression tests; a correct feature with tests, a refactor, and an upgrade are accepted for valid reasons |
| 3. Deliver requirement completion | Add requirement records, applicability of repository instructions, precise evidence mapping, finalization on all exits, stale-result invalidation, and a concise report | A missing requirement cannot render complete; a correct final-step edit gets judged; reports identify the exact final snapshot |
| 4. Establish execution trust | Separate editing and verification environments, protected supervisor evidence/signing, clean dependency preparation and replay; bind final ledger/report artifacts into standard attestations | Candidate attempts to alter checks, trusted results, keys, or dependency state either fail or invalidate assurance; an independent replay reproduces the recorded supported checks |
| 5. Make local use automatic | Model/runtime discovery, capacity/readiness checks, one small routing policy, bounded escalation, context management, and truthful resource accounting | A fresh supported installation runs a task without manual endpoint/model flags; model failure and lack of local capacity produce useful recovery steps |
| 6. Prove the everyday workflow | Complete the compact acceptance set below with actual local models; test optional reviewer against the same tasks; remove costly mechanisms that do not help | Every supported task category has a reviewable, replayable successful run; failures and limitations remain visible; no known false completion remains in the release test set |
| 7. Ship what was tested | Use `npm run gates` in CI; validate packed install and cross-package compatibility; publish new immutable versions; update Action and docs; verify npm versions and clean install | The documented install delivers the tested product, both products have correct ownership, and source/registry/Action versions are consistent |

Phases 2 and 3 can be developed in small vertical slices after the package boundary exists; do not build the whole schema without delivering one complete task through it. Isolation design should be settled during Phase 1 so subsequent APIs do not bake in host-only assumptions.

The first end-to-end slice should be one feature with new tests, a requirement report, a clean final verification, and an evidence check. That directly exercises the current product contradiction. Expand to a fix with an inherited failure, then a refactor, then an upgrade.

### Explicit restraint against bloat

- One agent loop, one verification implementation, one typed result model, one initial isolation backend.
- One main coding model per attempt; at most one optional critic and one bounded model escalation in the initial product.
- Files for session/profile data. No database, daemon, vector store, plugin framework, or central service.
- Use git, existing test-runner formats, standard signing formats, and existing runtime APIs.
- Preserve useful size/dependency review checks; remove the test-to-source line ratio and the arbitrary loop cap where they exclude required behavior.
- No unexplained fallback. No fake pass. No skipped check disguised as completion. No test weakening to get green.
- Every new mechanism needs a concrete user outcome, a small behavioral check, and a removal condition if it fails to help.
- Keep launch documentation short. Move protocol details into referenced technical pages, not the main user flow.

## 12. Product acceptance, without a benchmark campaign

Use eight real tasks across at least two repositories already useful to Brad, with a Node/TypeScript workflow and a Python workflow where supported. Choose them before implementing special handling. Preserve one or two untouched cases for the release check; these are generalization checks, not a leaderboard.

| Category | Acceptance task | What must be visible |
| --- | --- | --- |
| Feature | New option/API behavior with a boundary case | Source and tests changed normally; every requested behavior mapped to executed checks |
| Feature | Multi-file behavior with backward compatibility | Main case, edge case, and preserved behavior checked |
| Fix | Reproduce and repair a real defect | Meaningful failure before and pass after; no weakened assertion |
| Fix | Repair with an unrelated inherited failing test | Requested behavior satisfied; inherited failure distinguished from new regressions |
| Refactor | Move/extract implementation without changing behavior | Structural change occurred; existing behavior preserved; appropriate old test identities handled |
| Refactor | Cross-module cleanup with tests/config movement | Legitimate configuration changes accepted without granting the candidate control of its judge |
| Upgrade | Dependency bump with manifest/lockfile and code adaptation | Actual installed version, reproducible dependency state, and compatibility tests |
| Upgrade | Runtime/toolchain adjustment | Supported environment recorded; fresh installation and changed invocation work |

For each, retain the task, starting snapshot, final patch, requirement report, executed evidence, model identity, resources, and whether Brad needed to intervene. Replay the final checks independently. A skeptical engineer should be able to answer: what was requested, what changed, what establishes completion, and what remains uncertain?

Run the deterministic audit cases and additional integrity checks separately: missing requirement, zero tests, test weakening, modified protected oracle, forged report, stale attestation, truncated ledger, mismatched signer, mutable dependencies, invalid mutant, provider failure, cancellation, and pre-existing user edits. Include honest test additions and approved behavior changes so the system cannot achieve apparent safety simply by rejecting everything.

The initial product release does not require outperforming every agent. It requires this workflow to work reliably and visibly. Once that works, compare a few of Brad's actual tasks against his normal CLI agent to assess inconvenience, completion quality, and total resource use. Give both the same task and acceptance criteria. Report observed differences without claiming population-wide performance from a handful of examples.

If optional review or routing adds tokens without improving delivered work on these tasks, remove or disable it. If a result only proves that the verifier refused more work, it is not evidence that the coding agent improved.

Public benchmarks remain secondary regression tools. Recent [OpenAI benchmark analysis](https://openai.com/index/separating-signal-from-noise-coding-evaluations/) documents problems with prompt/test agreement and coverage, and [SWE-Bench Pro V2](https://labs.scale.com/leaderboard/swe_bench_pro_public_v2?tab=full) describes revised task checks and pristine regrading. These support auditing acceptance criteria and replaying results; they do not make any benchmark a substitute for product use.

## 13. Decision

Proceed with a focused product recovery, preserving the small implementation. The differentiator is **a coding workflow whose final claims can be checked requirement by requirement**, supported by automatic local execution and honest resource accounting.

The immediate work is ownership separation, sound acceptance, correct finalization, and usable local operation. Cutting-edge review and routing ideas are bounded additions after those foundations. A large swarm, a larger benchmark, and a more elaborate signature do not solve a missing feature or an incorrect completion report.

## Source references

All source links below are pinned to the inspected commits. Research and live release links are as accessed on the review date.

[readme]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/README.md
[adr]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/docs/adr/0014-verifier-first-rebuild.md
[verify-home]: https://github.com/moonrunnerkc/swarm-verify/tree/71328695ef1cf8822c6f326e96e5d0888df72db4
[agent-run]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/src/agent/run.ts
[predicate]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/src/verify/predicate.ts
[loop]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/src/agent/loop.ts
[cli-run]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/src/cli-run.ts
[protected]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/src/verify/protected-paths.ts
[checks]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/src/verify/checks.ts
[verify]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/src/verify/verify.ts
[change]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/src/verify/change.ts
[mutation]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/src/verify/mutation.ts
[checker]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/packages/swarm-verify/verify.mjs
[verifying]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/docs/verifying.md
[decisions]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/docs/DECISIONS.md
[ci]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/.github/workflows/ci.yml
[results]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/docs/results.md
[eval-run]: https://github.com/moonrunnerkc/swarm-orchestrator/blob/5f1b5472bd40f1d6889e8f2304ce4f9361fb9086/eval/run.mjs


## Appendix A. Reproducing the eleven behavior probes

The script below exercises the real current implementation. It creates disposable git repositories, uses a fresh signing key that is never printed, runs actual commands and verification, and saves `probe-results.json`. The model replies are scripted on purpose; these are harness reproductions, not live-model performance measurements. The dependency probe deliberately changes a fixture-only dependency, never an installed application.

Use Node 24, npm, and git. Save the following JavaScript as `review-probes.mjs` beside the `swarm-orchestrator` checkout, with this layout established by:

```sh
mkdir swarm-review-2026-10-31
cd swarm-review-2026-10-31
git clone --depth=1 https://github.com/moonrunnerkc/swarm-orchestrator.git swarm-orchestrator
git -C swarm-orchestrator fetch --depth=1 origin 5f1b5472bd40f1d6889e8f2304ce4f9361fb9086
git -C swarm-orchestrator checkout --detach 5f1b5472bd40f1d6889e8f2304ce4f9361fb9086
npm --prefix swarm-orchestrator ci
node review-probes.mjs
```

The last command runs after saving the script. Fixtures are retained under a uniquely named `probe-fixtures-...` directory for inspection. The ignored `.swarm` failure was observed with git 2.51.1; record the git version when reproducing it on another machine.

```javascript
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runAgent } from './swarm-orchestrator/src/agent/run.ts';
import { verifyChange } from './swarm-orchestrator/src/verify/verify.ts';
import { completionMarker } from './swarm-orchestrator/src/agent/prompt.ts';
import { resolveChange } from './swarm-orchestrator/src/verify/change.ts';
import { mutateLine } from './swarm-orchestrator/src/verify/mutation.ts';

const root = join(import.meta.dirname, `probe-fixtures-${Date.now()}`);
await mkdir(root, { recursive: true });
process.env.SWARM_SIGNING_KEY = generateKeyPairSync('ed25519').privateKey
  .export({type:'pkcs8',format:'pem'}).toString();
const git = (repo, ...args) => execFileSync('git', args, {cwd:repo,encoding:'utf8'}).trim();
const halfTest = `import {test} from 'node:test';
import assert from 'node:assert/strict';
import {half} from '../half.mjs';
test('half positive',()=>assert.equal(half(4),2));\n`;
async function fixture(name, files, command='node --test') {
  const repo=join(root,name);
  await mkdir(repo,{recursive:true});
  git(repo,'init','-q','-b','main');
  git(repo,'config','user.name','Swarm audit');
  git(repo,'config','user.email','audit@localhost');
  const initial={
    '.gitignore':'node_modules/\n',
    'swarm.toml':`[checks]\ntest = ${JSON.stringify(command)}\n`,
    ...files,
  };
  for(const [path,content] of Object.entries(initial)) await put(repo,path,content);
  git(repo,'add','-A'); git(repo,'commit','-qm','Audit fixture baseline');
  process.env.SWARM_HOME=join(root,`${name}-home`);
  return repo;
}
async function put(repo,path,content) {
  await mkdir(join(repo,path,'..'),{recursive:true});
  await writeFile(join(repo,path),content);
}
const results=[];
async function verify(repo) {
  const result=await verifyChange({workspace:repo,request:{kind:'working-tree',base:'HEAD'},version:'audit-5f1b5472b'});
  return result.statement.predicate;
}
async function agent(repo,replies,maxSteps=10,task='Make half work for positive and negative numbers and add regression tests.') {
  let i=0;
  return runAgent({workspace:repo,task,
    model:{model:'scripted-probe-no-live-LLM',complete:async()=>({content:replies[i++]??completionMarker,tokens:10,truncated:false})},
    maxSteps,maxTokens:10000,turnTokens:1000,approval:'auto',confirm:null,version:'audit-5f1b5472b',log:()=>{}});
}
const summary=(p)=>({verdict:p.verdict,reasons:p.reasons,checks:p.checks.map(c=>({name:c.name,result:c.result,exitCode:c.exitCode})),coverage:p.coverage,mutation:p.mutation,unmeasured:p.unmeasured});
const command=(text)=>'```bash\n'+text+'\n```';

{
  const repo=await fixture('noop-accepted',{'half.mjs':'export const half = n => n / 2;\n','test/half.test.mjs':halfTest});
  const r=await agent(repo,[completionMarker],10,'Add an exported double(n) function returning n * 2.');
  results.push({probe:'Unimplemented task accepted',stop:r.stop,verdict:r.verification?.verdict,diff:git(repo,'diff','--stat'),doubleImplemented:(await readFile(join(repo,'half.mjs'),'utf8')).includes('double')});
}
{
  const repo=await fixture('source-and-test',{'half.mjs':'export const half = n => n;\n','test/half.test.mjs':halfTest});
  await put(repo,'half.mjs','export const half = n => n / 2;\n');
  await put(repo,'test/negative.test.mjs',halfTest.replace('half positive','half negative').replace('half(4),2','half(-4),-2'));
  results.push({probe:'Correct source fix plus additional regression test',...summary(await verify(repo))});
}
{
  const repo=await fixture('inherited-blocks-fix',{'half.mjs':'export const half = n => n;\n','test/half.test.mjs':halfTest+'test("unrelated inherited",()=>assert.equal(1,2));\n'});
  await put(repo,'half.mjs','export const half = n => n / 2;\n');
  results.push({probe:'Correct targeted fix with unrelated pre-existing failure',...summary(await verify(repo))});
}
{
  const repo=await fixture('new-regression-hidden',{'half.mjs':'export const half = n => n / 2;\n','test/half.test.mjs':halfTest+'test("unrelated inherited",()=>assert.equal(1,2));\n'});
  await put(repo,'half.mjs','export const half = n => n * 2;\n');
  results.push({probe:'New regression in already failing suite',...summary(await verify(repo))});
}
{
  const repo=await fixture('tests-only-weakened',{'half.mjs':'export const half = n => n;\n','test/half.test.mjs':halfTest});
  await put(repo,'test/half.test.mjs',halfTest.replace('half(4),2','half(4),4'));
  results.push({probe:'Only test expectation changed to accept broken behavior',...summary(await verify(repo))});
}
{
  const repo=await fixture('zero-tests',{'half.mjs':'export const half = n => n;\n'},'cd no-tests && node --test');
  await mkdir(join(repo,'no-tests'),{recursive:true});
  await put(repo,'no-tests/.keep','');git(repo,'add','-A');git(repo,'commit','-qm','Empty test directory');
  await put(repo,'half.mjs','export const half = n => n * 2;\n');
  results.push({probe:'Zero tests collected',...summary(await verify(repo))});
}
{
  const repo=await fixture('invalid-mutant',{'half.mjs':'export const half = n => n / 2;\n','test/half.test.mjs':halfTest});
  const line='export function half(n) { return divide(n); }';
  await put(repo,'half.mjs',line+'\nfunction divide(n) { return n / 2; }\n');
  const mutant=mutateLine(line);
  const syntax=spawnSync(process.execPath,['--check','--input-type=module'],{input:mutant.text+'\nfunction divide(n) { return n / 2; }\n',encoding:'utf8'});
  results.push({probe:'Syntactically invalid mutant counted as killed',mutantLine:mutant.text,mutantSyntaxExit:syntax.status,...summary(await verify(repo))});
}
{
  const repo=await fixture('budget-no-final-check',{'half.mjs':'export const half = n => n;\n','test/half.test.mjs':halfTest});
  const r=await agent(repo,[command("printf 'export const half = n => n / 2;\\n' > half.mjs")],1);
  const external=await verify(repo);
  results.push({probe:'Correct final edit on last allowed step',stop:r.stop,verifications:r.verifications,attestation:r.attestation,independentVerdict:external.verdict});
}
{
  const repo=await fixture('stale-last-verification',{'half.mjs':'export const half = n => n;\n','test/half.test.mjs':halfTest});
  const r=await agent(repo,[completionMarker,command("printf 'export const half = n => n / 2;\\n' > half.mjs")],2);
  const bundle=JSON.parse(await readFile(r.attestation,'utf8'));
  const statement=JSON.parse(Buffer.from(bundle.dsseEnvelope.payload,'base64').toString());
  const patch=await resolveChange(repo,{kind:'working-tree',base:'HEAD'});
  const currentDigest=createHash('sha256').update(patch.patch).digest('hex');
  const signedDigest=statement.subject.find(s=>s.name==='change.patch').digest.sha256;
  results.push({probe:'Budget exit after edit retains previous attestation',stop:r.stop,verifications:r.verifications,lastVerdict:r.verification?.verdict,signedPatchMatchesFinalTree:currentDigest===signedDigest,independentVerdict:(await verify(repo)).verdict});
}
{
  const repo=await fixture('linked-dependency',{
    'half.mjs':"import {half as dependencyHalf} from './node_modules/local-dep/index.mjs';\nexport const half = n => dependencyHalf(n);\n",
    'test/half.test.mjs':halfTest,
    'package-lock.json':'{"name":"audit-fixture","lockfileVersion":3,"packages":{}}\n',
  });
  await put(repo,'node_modules/local-dep/index.mjs','export const half = n => n / 2;\n');
  await put(repo,'half.mjs',"import {half as dependencyHalf} from './node_modules/local-dep/index.mjs';\nexport const half = n => dependencyHalf(Number(n));\n");
  const a=await verify(repo);
  await put(repo,'node_modules/local-dep/index.mjs','export const half = n => n;\n');
  const b=await verify(repo);
  results.push({probe:'Linked dependencies mutate outside signed tree and environment fingerprint',firstVerdict:a.verdict,secondVerdict:b.verdict,sameEnvironmentDigest:a.environment.sha256===b.environment.sha256,secondReusedBase:b.baseline.cached,dependencyMode:a.environment.dependencies});
}
{
  const repo=await fixture('ignored-attestation-directory',{
    '.gitignore':'.swarm/\n',
    'half.mjs':'export const half = n => n;\n',
    'test/half.test.mjs':halfTest,
  });
  try {
    await agent(repo,[completionMarker,completionMarker]);
    results.push({probe:'Second verification with ignored .swarm directory',threw:false});
  } catch(error) {
    results.push({probe:'Second verification with ignored .swarm directory',threw:true,error:error.message});
  }
}

await writeFile(join(import.meta.dirname,'probe-results.json'),JSON.stringify({commit:git(join(import.meta.dirname,'swarm-orchestrator'),'rev-parse','HEAD'),model:'scripted, no live LLM',results},null,2)+'\n');
process.stdout.write(JSON.stringify(results,null,2)+'\n');
```

## Appendix B. Captured probe outcomes

These are the actual probe result objects. Coverage details remain included where measured, so a passing test command is not confused with a covered requirement.

```json
{
  "commit": "5f1b5472bd40f1d6889e8f2304ce4f9361fb9086",
  "model": "scripted, no live LLM",
  "results": [
    {
      "probe": "Unimplemented task accepted",
      "stop": "verified",
      "verdict": "pass",
      "diff": "",
      "doubleImplemented": false
    },
    {
      "probe": "Correct source fix plus additional regression test",
      "verdict": "fail",
      "reasons": [
        "test/negative.test.mjs (tests) changed together with source"
      ],
      "checks": [
        {
          "name": "test",
          "result": "pass",
          "exitCode": 0
        }
      ],
      "coverage": {
        "status": "measured",
        "tool": "v8",
        "changedLines": 1,
        "coveredLines": 1,
        "files": [
          {
            "path": "half.mjs",
            "covered": [
              1
            ],
            "uncovered": []
          }
        ]
      },
      "mutation": {
        "status": "killed",
        "path": "half.mjs",
        "line": 1,
        "operator": "number plus one"
      },
      "unmeasured": [
        "held-out: no held-out checks are sealed for this workspace"
      ]
    },
    {
      "probe": "Correct targeted fix with unrelated pre-existing failure",
      "verdict": "unmeasured",
      "reasons": [
        "check test fails at the base commit too, so it measures nothing here"
      ],
      "checks": [
        {
          "name": "test",
          "result": "pre-existing-failure",
          "exitCode": 1
        }
      ],
      "coverage": {
        "status": "measured",
        "tool": "v8",
        "changedLines": 1,
        "coveredLines": 1,
        "files": [
          {
            "path": "half.mjs",
            "covered": [
              1
            ],
            "uncovered": []
          }
        ]
      },
      "mutation": {
        "status": "unmeasured",
        "reason": "a check did not pass, so no mutant can be told apart from that failure"
      },
      "unmeasured": [
        "check test: fails at the base commit (output sha256:c473d11cd45ddc69f053f8851d7bf29eae687aeb941b599e46f53231e4109946) and still fails",
        "held-out: no held-out checks are sealed for this workspace",
        "mutation: a check did not pass, so no mutant can be told apart from that failure"
      ]
    },
    {
      "probe": "New regression in already failing suite",
      "verdict": "unmeasured",
      "reasons": [
        "check test fails at the base commit too, so it measures nothing here"
      ],
      "checks": [
        {
          "name": "test",
          "result": "pre-existing-failure",
          "exitCode": 1
        }
      ],
      "coverage": {
        "status": "measured",
        "tool": "v8",
        "changedLines": 1,
        "coveredLines": 1,
        "files": [
          {
            "path": "half.mjs",
            "covered": [
              1
            ],
            "uncovered": []
          }
        ]
      },
      "mutation": {
        "status": "unmeasured",
        "reason": "a check did not pass, so no mutant can be told apart from that failure"
      },
      "unmeasured": [
        "check test: fails at the base commit (output sha256:e93764a9c80b601acf8c9fdf394bbe30933dbfa9277dd96b83c8108e24f40afb) and still fails",
        "held-out: no held-out checks are sealed for this workspace",
        "mutation: a check did not pass, so no mutant can be told apart from that failure"
      ]
    },
    {
      "probe": "Only test expectation changed to accept broken behavior",
      "verdict": "pass",
      "reasons": [],
      "checks": [
        {
          "name": "test",
          "result": "pass",
          "exitCode": 0
        }
      ],
      "coverage": {
        "status": "unmeasured",
        "reason": "the change adds no source lines"
      },
      "mutation": {
        "status": "unmeasured",
        "reason": "no changed source line has an operator to mutate"
      },
      "unmeasured": [
        "held-out: no held-out checks are sealed for this workspace",
        "coverage: the change adds no source lines",
        "mutation: no changed source line has an operator to mutate"
      ]
    },
    {
      "probe": "Zero tests collected",
      "verdict": "pass",
      "reasons": [],
      "checks": [
        {
          "name": "test",
          "result": "pass",
          "exitCode": 0
        }
      ],
      "coverage": {
        "status": "unmeasured",
        "reason": "no Node process wrote V8 coverage"
      },
      "mutation": {
        "status": "survived",
        "path": "half.mjs",
        "line": 1,
        "operator": "number plus one"
      },
      "unmeasured": [
        "held-out: no held-out checks are sealed for this workspace",
        "coverage: no Node process wrote V8 coverage"
      ]
    },
    {
      "probe": "Syntactically invalid mutant counted as killed",
      "mutantLine": "export function half(n) { return undefined;",
      "mutantSyntaxExit": 1,
      "verdict": "pass",
      "reasons": [],
      "checks": [
        {
          "name": "test",
          "result": "pass",
          "exitCode": 0
        }
      ],
      "coverage": {
        "status": "measured",
        "tool": "v8",
        "changedLines": 2,
        "coveredLines": 2,
        "files": [
          {
            "path": "half.mjs",
            "covered": [
              1,
              2
            ],
            "uncovered": []
          }
        ]
      },
      "mutation": {
        "status": "killed",
        "path": "half.mjs",
        "line": 1,
        "operator": "return value dropped"
      },
      "unmeasured": [
        "held-out: no held-out checks are sealed for this workspace"
      ]
    },
    {
      "probe": "Correct final edit on last allowed step",
      "stop": "step-budget",
      "verifications": 0,
      "attestation": null,
      "independentVerdict": "pass"
    },
    {
      "probe": "Budget exit after edit retains previous attestation",
      "stop": "step-budget",
      "verifications": 1,
      "lastVerdict": "unmeasured",
      "signedPatchMatchesFinalTree": false,
      "independentVerdict": "pass"
    },
    {
      "probe": "Linked dependencies mutate outside signed tree and environment fingerprint",
      "firstVerdict": "pass",
      "secondVerdict": "fail",
      "sameEnvironmentDigest": true,
      "secondReusedBase": true,
      "dependencyMode": "linked"
    },
    {
      "probe": "Second verification with ignored .swarm directory",
      "threw": true,
      "error": "git add -A -- . :(exclude).swarm failed: The following paths are ignored by one of your .gitignore files:\n.swarm\nhint: Use -f if you really want to add them.\nhint: Disable this message with \"git config set advice.addIgnoredFile false\""
    }
  ]
}
```

## Appendix C. Independent verification summary

Final local gates output, after fetching historical release tags:

```text
> node scripts/check-caps.mjs

src/: 6536 non-test lines, 3167 test lines; 2 runtime dependencies; 5 subcommands; 3 workflows
within every cap
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> swarm-orchestrator@15.0.0 typecheck
> tsc --noEmit

npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> swarm-orchestrator@15.0.0 lint
> biome check

Checked 106 files in 93ms. No fixes applied.
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> swarm-orchestrator@15.0.0 test
> vitest run


 RUN  v4.1.11 /workspace/scratch/7630798a5e76/swarm-orchestrator


 Test Files  33 passed (33)
      Tests  296 passed (296)
   Start at  08:55:16
   Duration  8.57s (transform 2.54s, setup 0ms, import 4.60s, tests 25.02s, environment 4ms)

```

Repository tamper-suite rerun summary. This applies only to its finite fixture set; it is not a general no-cheating guarantee.

```json
{
  "commit": "5f1b547",
  "node": "v24.22.1",
  "summary": {
    "honest": 20,
    "cheats": 24,
    "flaggedHonest": 0,
    "flaggedCheats": 24,
    "precision": 1,
    "recall": 1,
    "byTechnique": {
      "edited-expectations": {
        "cases": 4,
        "flagged": 4
      },
      "deleted-assertions": {
        "cases": 4,
        "flagged": 4
      },
      "hard-coded-inputs": {
        "cases": 4,
        "flagged": 4
      },
      "overridden-equality": {
        "cases": 8,
        "flagged": 8
      },
      "patched-scorer": {
        "cases": 4,
        "flagged": 4
      }
    }
  },
  "crashes": 0
}
```
