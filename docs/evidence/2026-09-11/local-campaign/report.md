# September 11 local campaign

Two implementation faults were found and fixed. Docker verification used host paths inside a
container whose checkout lives at `/workspace`, and macOS temporary checkouts could fall outside
the runtime's shared directories. Local thinking controls also omitted Ollama's
`reasoning_effort` field, so a request intended to answer without reasoning could spend its
whole output allowance without returning usable source. Both repairs have regression tests.

The local experiment is finished. The broader production claims are not. Ten topics yielded one
admitted practice case and one admitted evaluation case. That is enough to exercise the machinery
and expose faults, and nowhere near enough to estimate reliability or establish non-inferiority.
No independent human review or new-user observation is represented by these records.

## What was fixed

Fresh verification checkouts now live under the harness-owned evidence directory where the
container runtime can mount them. Git arguments inside that checkout are relative to its working
directory. The producing workspace still supplies only the patch and pinned base commit.
The container regression test applies a valid patch, runs its checks, and exercises restoration.
The original failures and passing rerun are under [validation](validation).

The local provider now sends all three thinking controls used by the supported compatible
servers. The SDK's `reasoningEffort` option becomes `reasoning_effort` on the wire, as required
by [Ollama's compatibility API](https://docs.ollama.com/api/openai-compatibility).
The wire-format tests failed before the change and passed after it. The recorded live repeats
also returned usable source. This measures the installed Ollama and model combination; a server
may reject or ignore an extension, and the existing rejection fallback remains in place.

## Population and admission

[setup.json](setup.json) fixed ten topics before authoring: two practice and eight evaluation.
Gemma 4 31B wrote the specification, reference, deliberately incomplete patch and public examples.
Mistral Small 3.2 24B received the specification alone and wrote separate checks. Qwen 3.6 35B A3B
was the solver. Model digests, container image identity, prompts, responses and failed requests
are retained. All models ran locally. Different model families are not independent human authors.

There was one author request per topic, one checker request per valid author response, and no
replacement of rejected cases. Admission required the reference to pass both check sets, and the
counterexample to pass public checks while failing an executed withheld assertion. A crash or
unavailable check was not promoted to that assertion. Expected answers stayed in the host
observer, outside the candidate's container; only inputs were supplied to candidate execution.

| Case | Admission observation |
| --- | --- |
| practice-clamp | Reference and withheld checks disagree. The checker supplied incorrect expectations for reversed bounds. Excluded. |
| practice-count | Reference passes both sets; omission passes public and fails withheld checks. Admitted for practice. |
| check-chunks | Counterexample's withheld execution unavailable. Excluded. |
| check-merge | Reference and withheld checks disagree. Excluded. |
| check-escape | Author response is malformed JSON. Excluded. |
| check-pages | Reference passes both sets; omission passes public and fails withheld checks. Admitted for evaluation. |
| check-frequency | Counterexample passes both check sets. Excluded. |
| check-path | Author request times out. Excluded. |
| check-partition | Author response has the wrong reference field type. Excluded. |
| check-rotate | Author request times out. Excluded. |

The complete observations are in [admissions.json](admissions.json), the original material in
[authored](authored) and [checked](checked), and the admitted population in [cases.json](cases.json).
Nothing was hand-corrected and quietly admitted after its result was seen.

## Frozen pilot and development repeat

The composition preflight consumed 22,314 tokens under an initial 20,000-token cap and correctly
stopped at the cap. Before either baseline selection or evaluation, the common allowance was
amended to 40,000 tokens, 180 seconds, and 1,800 output tokens per model call. That preflight is
excluded from comparative outcomes. Its record is [swarm-preflight.json](swarm-preflight.json).
A JSON-only warmup then failed before any scheduled baseline launch. Preparation resumed from
its saved, ledger-matched admissions; the failed warmup remains in the campaign bundle.

The two actual baseline arms were one completion and up to three completions with public-test
feedback. Selection used practice acceptance, then total elapsed time, then the fixed arm order.
Both initially failed to return usable JSON. The feedback arm won the declared latency tiebreak;
that does not make it a strong baseline. [baseline-selection.json](baseline-selection.json)
records both failures. The selected arm and ordinary `runAgentTask` then ran the same evaluation
case with the same model and budgets. The [protocol](protocol.json) preceded those launches.

| Original evaluation | Withheld acceptance | Certified by supplied oracle | Tokens | Total elapsed |
| --- | --- | --- | ---: | ---: |
| Direct with feedback | Unknown: unusable JSON | Unknown | 2,153 | 12.405 s |
| Swarm | Pass, within budget | Yes | 28,128 | 16.111 s |

Both planned outcomes settled; neither was dropped. Zero false greens among one judged Swarm
certification gives an illustrative Wilson upper bound of 79.35%. It establishes no population
bound. The failed baseline is still a failed launch, not a success or a silently removed pair.
[summary.json](summary.json) keeps failures, unknown judgments and the descriptive interval.

After repairing the provider, both practice arms and both evaluation arms ran again. These are
previously exposed development cases, not new held-out observations. The budgets stayed the same;
the new [protocol](recheck/protocol.json) binds the repaired source and the repeated schedule.

| Development repeat | Withheld acceptance | Certified by supplied oracle | Tokens | Total elapsed |
| --- | --- | --- | ---: | ---: |
| Direct with feedback | Pass, within budget | Yes | 589 | 4.982 s |
| Swarm | Pass, within budget | Yes | 32,972 | 14.412 s |

The [repeat summary](recheck/summary.json) records both acceptances. On this case Swarm used more
time and tokens. These are single observations with different harness work, not stable latency
estimates. Total elapsed includes verification; each successful run also records production time.
Dollar cost, electricity and hardware amortization were not measured. The repeats are not pooled
with the original pilot. Neither establishes the strongest available baseline or non-inferiority.

## What the attacks established

The legacy visible-oracle policy accepted the valid reference and the predetermined omission.
The latter is a known false green against the separately supplied requirements, recorded alongside
the reference acceptance in [attacks.json](attacks.json). The model's additional attack omitted
its export, so both execution checks were unavailable and verification refused it. That is a
failed attack attempt, not evidence that semantic omission attacks were defeated.

The same admitted checks were then explicitly supplied to the existing `required-obligations-v1`
policy. The [package](contracts/package.json) binds their bytes and both control patches before
grading. Under Docker, the complete reference was accepted and the omission was rejected at
`pagination-contract`. [contracts/summary.json](contracts/summary.json) records the named obligation
and each verdict. This closes the demonstrated omission when its requirement is supplied.
It does not make a visible oracle infer missing requirements, establish contract completeness,
or turn the same case into another independent observation.

## Security and cleanup

The [security protocol](security-protocol.json) declared a finite Docker matrix with synthetic
canaries. Five maintainer controls and three Mistral-authored attacks attempted host reads, host
writes and environment access, including process-root and symlink paths. Each had a positive
control that could reach the synthetic canary. A network probe first demonstrated connection
under its permissive control, then tested the defended backend. A separate workspace check
confirmed that ordinary work could execute.

All nine escape observations were denied. Five lifecycle observations passed: normal parent
exit, parent failure, timeout, cancellation, and abrupt harness death followed by resource repair.
The detached descendant was shown running before cleanup was evaluated. No owned containers
remained. The [security summary](security-summary.json) therefore records fourteen completed
observations and a passing functionality control.

This is Docker on the available Colima runtime and named image. Podman and nerdctl were absent;
the summary's historical `unsupportedBackends` field means unavailable on this machine, not
removed product support. These tests do not establish resistance to every kernel or dependency
exploit, independent adversarial review, or arbitrary host-daemon ownership. Restricted host
execution remains best effort. A killed harness needs supervision or subsequent repair.

## First use

The first-run fixture was created and its baseline test passed, recorded in the
`bundles/first-run-preflight` bundle in the [archive](archive.json.br). The packaged CLI smoke checks install
and command behavior. Neither observation contains a new user. The participant count is zero;
the ten-minute usefulness and comprehension claim remains unmeasured.

## Check and reproduce

The original evaluation binds source snapshots rooted at `ef4bf9a6f28e9bf894b2384a7dc2bf9f96d1b825`,
with the Docker repair applied. The development repeat additionally includes the provider repair.
Their exact source maps are in their protocols and their files under `tested-sources` in the [archive](archive.json.br).
The security script snapshot matches its protocol hash; its later metadata-environment cleanup
was not silently substituted for the tested bytes. Restore a snapshot at its original repository
paths with the repository dependencies when reproducing historical execution.

The losslessly compressed archive contains raw model responses, failed preparations, run records,
source snapshots and self-contained evidence bundles. Its [manifest](archive-manifest.json) binds
the compressed bytes and expanded size. Smaller observations remain readable beside it and are
checked against the archived copies too. Signatures use ephemeral keys. They establish byte integrity;
the git commit anchors the published inventory, and no independently authenticated signer is claimed.

From the checkout:

```sh
node scripts/local-campaign/verify-archive.mjs
# Optional: restore the exact artifacts to a new temporary directory for inspection.
node scripts/local-campaign/archive.mjs
npm run check:packaged
npm run gates
```

The archive check expands into a fresh temporary directory and removes it when finished. It
hashes every inventoried artifact, checks every bundle using the installed
verifier, checks the frozen source snapshots, and recomputes both campaign summaries from their
scheduled rows. The ordinary gates run that archive check too. The human-written report is an
interpretation of those observations, not another machine-verified verdict.

To run a new experiment, choose a fresh external `SWARM_CAMPAIGN_ROOT`, use the installed local
models named in [setup.json](setup.json), and run `prepare.mjs`, `run.mjs` and `security.mjs` from
`scripts/local-campaign`. Review the scope and runtime availability first. Existing frozen
campaign schedules refuse replay in place. Generating more convenience fixtures still cannot
substitute for independent admission, representative sampling or real first-time users.

The repository's 100 MB ceiling remains unchanged. One older, uncited generated review is also
preserved losslessly as
[review.html.gz](../../2026-08-18/shakedown/bundles/task-05-retry-resolved/review.html.gz).
Decompress it with `gzip -dc review.html.gz > review-restored.html` to read the original page.
Its ledger and payloads were not changed.
