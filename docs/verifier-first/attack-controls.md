# Attack controls: the twelve families and what executes each

The verifier-first assignment names twelve ways a candidate, its configuration, its
dependencies or a stale record can try to obtain an acceptance it has not earned. This table
binds each to the executed controls in this tree, read from the tests themselves on
2026-09-27 at `be1c5b50e` and the commits after it, with the honest grade of each: **real**
means a real process, repository, runner or container is exercised; **in-proc** means real
harness code over stubbed runners or hand-built records; **pure** means a parser or policy
function over literals. Each family also names what is still open. A pure control is not
counted as covering a boundary; it covers a rule.

Two caveats travel with every row. Tests wrapped in `skipIf(!docker)` skip without docker and
report that they did; the remote `gates` workflow runs them on Linux with docker. The
`redteam/pass*/closures.regression.ts` suites are outside the default include and are not
counted here.

## 1. An agent edits, deletes, skips or replaces a required assertion

| Control | Executes | Grade |
| --- | --- | --- |
| `src/gates/goal-acceptance.test.ts` "refuses producer changes to acceptance artifacts before invoking a check" | a patch overwriting the pinned artifact is refused by name, no check runs | real |
| `src/gates/goal-acceptance.test.ts` "records refusal when a check deletes its own pinned artifact" | a check unlinking its artifact is rejected | real |
| `src/agent-run.test.ts` "keeps a test deletion refused in the returned and recorded assessment" | a fixture model guts a test; the base ratchet refuses | real |
| `src/gates/goal-challenges.integration.test.ts` "shows a gap for a check the repository suite can outdo" | a check that accepts the base reads vacuous and is refused under `required` | real |
| `src/workers/adaptive-repair.test.ts` "refuses exported acceptance with an erased obligation, even when signed again" | an obligation removed from a re-signed bundle is refused | real |
| `src/gates/ratchet.test.ts`, `src/gates/auto-resolve.test.ts`, `src/evidence/redteam-adversarial.test.ts` (deletion, skip marker, tautology, self-comparison) | the ratchet's rules | in-proc, pure |

Open: a skipped test is refused by the ratchet's reading of the file and by the runner result
reader, not by a run in which a real runner executes a skipped test.

## 2. A project configuration prints well-formed passing runner JSON and exits before test execution

| Control | Executes | Grade |
| --- | --- | --- |
| `src/gates/browser-trust.integration.test.ts` "does not accept JSON forged by a real Playwright configuration before a failing test runs" | a real Playwright config prints passing JSON and exits 0; the reading is unjudged | real |
| `src/gates/browser-instrument.integration.test.ts` "isolates the sealed browser instrument from forged config, dependencies and test selection" | poisoned config and a substituted runner are never loaded by the sealed instrument | real, docker |
| `src/gates/runner-results.test.ts` "refuses vacuous, duplicate, forged or inconsistent output" | shaped forgeries are not-applicable | pure |

Open, and named as a trust-boundary residual rather than closed: for the Vitest and pytest
structured runners, the project's own configuration runs inside the runner process, so a
configuration that prints a complete, self-consistent report and exits 0 is read as the
runner's report. Those readers carry no ratchet or coverage authority and decide only the
tests gate's status; the sealed-instrument path exists only for browser checks today. The
control that will hold this is a real vitest configuration that forges the report, asserting
what the verifier records, until a sealed path for those runners exists.

## 3. A runner executable, reporter or dependency is substituted

| Control | Executes | Grade |
| --- | --- | --- |
| `src/evidence/redteam-adversarial.test.ts` "measures the second turn by the sealed command, not by the script the first turn wrote" | a turn rewrites the test script into a forged TAP printer; the sealed command still runs | real |
| `src/workers/merge-queue.test.ts` "measures the second layer by the gates of the commit the run branched from" | a landed forged `package.json` script does not change what the next layer is measured by | real |
| `src/gates/report-forgery.test.ts` "finds no destination to overwrite, and moves neither number" | a test hunts for reporter destinations and finds streams | real |
| `src/gates/harness-reporting.test.ts`, `src/gates/node-command-runner.test.ts`, `src/gates/base-control.test.ts` (`NODE_OPTIONS` hooks, forged tables) | inherited loader names are refused, forged tables ignored | real |
| `src/gates/browser-instrument.integration.test.ts` | a substituted `@playwright/test/cli.js` is ignored | real, docker |

Open: substituting a project-local `node` or `node_modules/.bin/vitest` on `PATH` is held only
by the non-gating pass7 regression.

## 4. Results omit a check, duplicate identities, contradict totals or contain only skipped tests

| Control | Executes | Grade |
| --- | --- | --- |
| `src/gates/runner-results.test.ts` | empty, only-skipped, duplicate-id and totals-mismatch reports read not-applicable, with the offline reader agreeing | pure |
| `src/gates/browser-results.test.ts` | missing, duplicate, inconsistent, retried and misidentified results | pure |
| `src/gates/browser-check.integration.test.ts` "refuses zero tests and runner startup failure" | a real zero-test spec is not accepted | real |
| `src/gates/package-assessment.integration.test.ts` "preserves unavailable checks in seals and mixed-package reports" | a package with no tests stays a blocking unmeasured check | real |
| `src/evidence/seal-conformance.test.ts` | a gate missing from the final cycle or dropped by a later turn is refused | pure |

Open: no real runner emits duplicates or contradictory totals in a test; those readings are
held by the readers' own cases.

## 5. Output or an artifact is truncated while the visible prefix looks successful

| Control | Executes | Grade |
| --- | --- | --- |
| `src/gates/behavior-check.test.ts` "distinguishes wrong exit, hanging, missing executable, and bounded output" | a process exceeding the output cap is unjudged although every expectation would pass | real |
| `src/gates/runner-results.test.ts` "does not promote a truncated report or ignore process failure" | a passing report with `outputTruncated` is not passed | pure |
| `src/evidence/redteam-adversarial.test.ts` "reads a truncated, header-only, or table artifact as not measured, never as 100%" | cut lcov reads null | pure |
| `src/action/artifacts.test.ts` | an 8 MB file is left out and named in the inventory | real |

Open: no real runner's passing report is cut by the byte ceiling in a test.

## 6. Evidence belongs to a different source tree or base

| Control | Executes | Grade |
| --- | --- | --- |
| `src/gates/independent-verification.test.ts` "does not read a report the worker wrote" | a worker-shipped result file is ignored by the fresh checkout | real |
| `src/gates/change-source.test.ts`, `src/gates/base-commit.test.ts` | merge-base and exact bases, moved bases, a fetched PR snapshot | real |
| `src/action/verify.test.ts` "fetches the pull request's objects, verifies the head, and writes a bound verdict" | verdict head, tree and report digest bound | real |
| `src/cli-verdict.test.ts` "reports evidence that no longer matches the document" | a changed report beside the verdict is named inconsistent | real |
| `src/action/comment.test.ts` "posts nothing when the pull request has moved past the verified head" | a stale head posts nothing | pure |

| `src/gates/attack-controls.test.ts` "refuses to run the contract's checks over a checkout whose tree is not the one named" | a real clone handed a tree id it does not hold: refused before any check, no goal-check record written | real |

Open: no test presents a verdict made for one head as evidence for another; the verdict
command binds by digest, and that cross-head case is next.

## 7. Check bytes, a lockfile, toolchain or relevant environment change after the recorded pass

| Control | Executes | Grade |
| --- | --- | --- |
| `src/gates/dependency-install.test.ts` "refuses an installer that changes source despite exit zero" | source fingerprint before and after | in-proc |
| `src/evidence/dependency-install.test.ts` | lock and source digests re-derived offline | in-proc |
| `src/gates/upgrade-contract.test.ts` | changed versions or manifest refused | pure |
| `src/gates/prepared-python.test.ts` | a `.pth` injection is refused at staging | real |
| `src/gates/container-install.integration.test.ts` "reaches the registry for the lockfile install only, then checks with the network off" | a real container install is recorded with `network: registry` and the checks still measure isolated | real, docker |

Open: every control fires at execution time; nothing re-checks a recorded pass after check
bytes, a lockfile or the toolchain change afterwards. The pre-commit integration binds evidence
to the staged tree and a later `git add` invalidates it by construction; a CI-side
invalidation on drift is next.

## 8. A correct but incomplete package subset is used to certify a larger change

| Control | Executes | Grade |
| --- | --- | --- |
| `src/gates/package-scope.test.ts` | paths outside the selection are reported; escaping and overlapping selections refused | pure |
| `src/gates/package-assessment.integration.test.ts` | a selected package with no tests stays blocking and unmeasured | real |
| `src/cli-check.test.ts`, `src/gates/check-plan.test.ts` | a root script over a workspace leaves the packages unmeasured by name; no root script is ambiguous | real |

| `src/gates/attack-controls.test.ts` "refuses a patch touching a file outside the selected packages, by name, before any check runs" | a real workspace of two packages; a patch touching the root is refused with the file named and no gate runs | real |

## 9. A candidate tries to write to the evidence/signing location or obtain verifier credentials

| Control | Executes | Grade |
| --- | --- | --- |
| `src/gates/report-forgery.test.ts` | a test process searches for report destinations and finds none | real |
| `src/gates/goal-acceptance.test.ts` (artifact link attacks) | links out of the checkout as artifact parents are refused | real |
| `src/gates/node-command-runner.test.ts`, `src/tools/shell-tool.test.ts` | provider keys withheld from declared, vouched and model-run commands | real |
| `src/tools/policy-guard.test.ts` "refuses the session store even though it sits outside the workspace check order" | the store is denied to tools | pure |
| `src/gates/isolated-gates.test.ts` | a gate in the container cannot read a host file | real, docker |
| `src/action/verify.test.ts` "refuses to run candidate code on the host under pull_request_target" | refused before anything runs | real |
| `src/evidence/resign-attack.test.ts`, `src/evidence/signer-trust.test.ts` | a re-signed bundle is refused against the expected signer | in-proc |

Open and stated in the product: in host mode candidate test code runs as the same user as the
verifier, so it can read what that user can; `src/tools/isolated-shell.test.ts` documents that
restricted is not contained. The Action runs candidates in a container by default, the session
store is owner-only, and signing keys live in the OS keychain, which candidate code on the host
could ask for as that user. A host-mode control that shows candidate code cannot alter a
bundle after export, and the recorded consequence of it trying, is next.

## 10. A source or file substitution occurs between pinning, execution and result collection

| Control | Executes | Grade |
| --- | --- | --- |
| `src/gates/goal-acceptance.test.ts` "rejects a check that mutates the candidate", "rejects a check that stages its source mutation to hide it from git diff" | a check that edits or stages the tree is rejected | real |
| `src/gates/goal-acceptance.test.ts` "runs each goal check without ignored artifacts left by a preceding check" | per-check restoration | real |
| `src/gates/independent-verification.test.ts` "still holds the patch after judging the base" | the patch is put back before measuring | real |
| `src/gates/goal-checkout.integration.test.ts` | git stays readable in the container after a snapshot restore | real, docker |

Open: a substitution by a process running beside the check, between `write-tree` and the run,
is not exercised; the check-level substitutions are.

## 11. Cancellation or a crash leaves a challenge/check repair unfinished before resume

| Control | Executes | Grade |
| --- | --- | --- |
| `src/workers/controller-recovery.test.ts` (repair intent before its graph, process death after landing, lost install completion) | real crashes and resumes | real |
| `src/workers/bootstrap.test.ts` "recovers a crash after effect intent and rejects altered owned files during cleanup" | real git | real |
| `src/gates/dependency-install.test.ts` (ambiguous setup, cancelled setup) | stub runner | in-proc |
| `src/gates/goal-effects.test.ts` "requires reconciliation of ambiguous effects" | an intent with no completion refuses the next verification | pure |

| `src/gates/attack-controls.test.ts` "refuses to challenge over an intent that no completion answers, naming the challenge" | a challenge intent with no completion on the chain: the next challenge run refuses with `ChallengeReconciliationError`, executes nothing and writes no second plan | in-proc |

Open: a real process killed mid-mutation, then resumed, is held by the same reconciliation
rule the in-proc control exercises; the killed-process form is next.

## 12. A stale accepted result is replayed after integration or a check revision

| Control | Executes | Grade |
| --- | --- | --- |
| `src/workers/adaptive-repair.test.ts` "turns a typed missing dependency discovery into a revision and refuses the stale candidate" | a stale candidate never lands | real |
| `src/workers/merge-queue.test.ts` "falls to the next attempt when the integrated gates refuse the chosen one" | real git | real |
| `src/workers/controller-state.test.ts` (duplicate dispatch, late candidate, invalidated acceptance, rehashed revision) | records | in-proc |
| `src/evidence/ledger.test.ts` "resumes a valid chain and refuses a stale writer without forking history" | real files | real |
| `src/evidence/redteam-adversarial.test.ts` "leaves the earlier verdict standing when a later record reuses the digest" | records | in-proc |

| `src/gates/attack-controls.test.ts` "derives a fresh verdict for a revised contract and never cites the earlier one" | the same patch verified under a weak contract (accepted, challenge gap) and then a revised strong contract: every record on the second chain carries the revised digest only, the verdict is derived fresh, and the weak contract's gap stands | real |
