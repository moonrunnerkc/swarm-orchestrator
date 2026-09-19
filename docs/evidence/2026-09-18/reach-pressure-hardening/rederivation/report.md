# Reach pressure: does enforcing changed-line reach change held-back correctness?

## Identity

- Protocol generation 3, protocol digest `sha256:9d24e8a6f74e5d6eeac389a3b546d280cadf95536b8bccdcc8b4b98845a229b5`
- Manifest digest `sha256:07a5a50b2b0d5cc87d746e214eee0c92ae1ca9828cd68adc463f579a5a0ea81a`
- Experiment driver digest `sha256:a962c7a420d14229d797819477050bd5076dcf8fedf5656f5631f1747d06d830`, policy digest `sha256:07c1cf1bee31eafc4ce345babf8565249712325597aa7af56a58211f9b03afc4`
- This page was derived with driver sources `sha256:79783b9ebeda48c2e513788caf187ed43eeaf376ae9d50e843300e4a4ba0e40c`, which differ from the registered ones. The rows were written under the registered driver
- Derivation identities: analysis `sha256:56d2d47aefac5ce6f1680fe1031f2453d6c05542077a96afd45aa32f5e46e643`, renderer `sha256:86b120fec456dbd55a58c8de6cc7a4e22040eef21511d09a1cc073b93eccc6e7`, scoring `sha256:49ae15fcc86476e8744f683024ca62fce2b64c5608848f0115da46dcb47b8d79`, acquisition sources as they stand `sha256:1fe516dc066b6accd10a4492126a42ba7e1e1044b796db5c3f28a58c43ce47a1`. The rows and held-back scores are historical observations and are not re-derived; every number below is derived from them
- Against the published summary `sha256:7604c90d0121b5fd3e4a318f7b1e91eac4b214967ded5e170a74870f4e066fbc`: no value the published summary carries changed. Values changed: `/schema`. Fields removed: none. Fields added: 41. The published summary and page stand beside this one, unmodified
- Harness commit `dce76cc7e64de048db0b98e02d59c16e5c35be42`
- Model `local:malekoo/Qwen3.8-27B-MLX-8bit` at `http://127.0.0.1:8000/v1`; no sampling parameters are sent, so the server's defaults decide decoding (see the protocol)
- Agent budget per invocation: 12 wall minutes, 1000000 tokens; at most 2 invocation(s) before visible acceptance and 2 reach repair invocation(s) after it
- Environment: Node v24.15.0, darwin 25.6.0 arm64, Apple M5 Max, 18 cores
- Data digests: results `sha256:5a4f4732e405bb265b429231d82ea9d3923f189332049490777ff194b17321c8`, held-back scores `sha256:08306f6f0b03a93627fe3ca9fb634848f09e8dc1fd538d07ee1b4fe1be2dc46a`, summary `sha256:9f300141b42c257f8f062b77ec8cadb85c0aa10466729e2fa5b9bbe1a5b86c7a`

## Accounting

- Cohort `mined-pr-viable-79`. Frozen tasks: 79; settled: 79; interrupted attempts kept on the ledger: 1
- Terminal statuses: never-visible-accepted 66, reach-not-triggered 4, reach-repair-exhausted 9
- Judgeable pairs (both patches carry a held-back pass or fail): 79
- Tasks that reached visible acceptance: 13
- Of those, tasks where reach was measured at acceptance: 13
- Tasks where reach triggered (accepted, and the visible oracle never ran an added line): 9; repaired to satisfy reach: 0; repair budget exhausted: 9
- Agent invocations: 164, of which 9 did not report usage
- Usage accounting is incomplete: 9 of 164 invocation(s) did not report tokens and 0 did not report a model-call count. Totals: 6489 model call(s), unknown input and unknown output tokens. The invocations that did report sum to 6489 model call(s), 115168400 input and 497709 output tokens, which is a lower bound and not the total

## Primary outcome

Denominator: 79 judgeable tasks of the frozen cohort.

| control held-back result | reach held-back result | reading | tasks | share |
| --- | --- | --- | --- | --- |
| pass | pass | no correctness change | 12 | 15.2% |
| fail | pass | reach helped | 0 | 0.0% |
| pass | fail | reach hurt | 0 | 0.0% |
| fail | fail | neither condition completed the held-back behaviour | 67 | 84.8% |

- Held-back pass rate: control 15.2%, reach 15.2%.
- Harm count (control pass, reach fail): 0. Help count (control fail, reach pass): 0.
- Exact two-sided McNemar over 0 discordant pair(s): p = 1.0000 (`mcnemar-exact-binomial-two-sided`).
- Paired difference in held-back pass rate, reach minus control: +0.0 points, 95% CI [-4.0, +4.0] over 79 pair(s) (`newcombe-paired-score-95`).

## Reading

Under the predeclared rule the evidence is insufficient for a population-level claim that reach enforcement raises or lowers the held-back pass rate in this corpus with this model.

With 0 discordant pair(s) the exact test cannot reach 5% whichever way they fall, so this cohort cannot support a population claim in either direction. That is a statement about power and not about the effect.

No pair shows the harmful direction, so this run does not show that it can happen here. It does not show that it cannot.

## The same table over narrower denominators

Pairs outside the fork are one patch scored once, so they are concordant by construction. These
subsets show the effect conditional on the treatment having been possible.

Denominator: 13 judgeable tasks that reached visible acceptance.

| control held-back result | reach held-back result | reading | tasks | share |
| --- | --- | --- | --- | --- |
| pass | pass | no correctness change | 11 | 84.6% |
| fail | pass | reach helped | 0 | 0.0% |
| pass | fail | reach hurt | 0 | 0.0% |
| fail | fail | neither condition completed the held-back behaviour | 2 | 15.4% |

- Held-back pass rate: control 84.6%, reach 84.6%.
- Harm count (control pass, reach fail): 0. Help count (control fail, reach pass): 0.
- Exact two-sided McNemar over 0 discordant pair(s): p = 1.0000 (`mcnemar-exact-binomial-two-sided`).
- Paired difference in held-back pass rate, reach minus control: +0.0 points, 95% CI [-20.6, +20.6] over 13 pair(s) (`newcombe-paired-score-95`).

Denominator: 9 judgeable tasks where reach triggered.

| control held-back result | reach held-back result | reading | tasks | share |
| --- | --- | --- | --- | --- |
| pass | pass | no correctness change | 7 | 77.8% |
| fail | pass | reach helped | 0 | 0.0% |
| pass | fail | reach hurt | 0 | 0.0% |
| fail | fail | neither condition completed the held-back behaviour | 2 | 22.2% |

- Held-back pass rate: control 77.8%, reach 77.8%.
- Harm count (control pass, reach fail): 0. Help count (control fail, reach pass): 0.
- Exact two-sided McNemar over 0 discordant pair(s): p = 1.0000 (`mcnemar-exact-binomial-two-sided`).
- Paired difference in held-back pass rate, reach minus control: +0.0 points, 95% CI [-24.7, +24.7] over 9 pair(s) (`newcombe-paired-score-95`).

Denominator: 0 judgeable tasks where reach triggered and the repair satisfied it.

| control held-back result | reach held-back result | reading | tasks | share |
| --- | --- | --- | --- | --- |
| pass | pass | no correctness change | 0 | 0.0% |
| fail | pass | reach helped | 0 | 0.0% |
| pass | fail | reach hurt | 0 | 0.0% |
| fail | fail | neither condition completed the held-back behaviour | 0 | 0.0% |

- Held-back pass rate: control n/a, reach n/a.
- Harm count (control pass, reach fail): 0. Help count (control fail, reach pass): 0.
- Exact two-sided McNemar over 0 discordant pair(s): p = 1.0000 (`mcnemar-exact-binomial-two-sided`).
- Paired difference in held-back pass rate, reach minus control: +0.0 points, 95% CI [-100.0, +100.0] over 0 pair(s) (`newcombe-paired-score-95`).

## Secondary: a pass that also requires the repository's own checks to pass

Denominator: 79 judgeable tasks, a pass also requiring the repository's own checks to pass.

| control held-back result | reach held-back result | reading | tasks | share |
| --- | --- | --- | --- | --- |
| pass | pass | no correctness change | 11 | 13.9% |
| fail | pass | reach helped | 0 | 0.0% |
| pass | fail | reach hurt | 0 | 0.0% |
| fail | fail | neither condition completed the held-back behaviour | 68 | 86.1% |

- Held-back pass rate: control 13.9%, reach 13.9%.
- Harm count (control pass, reach fail): 0. Help count (control fail, reach pass): 0.
- Exact two-sided McNemar over 0 discordant pair(s): p = 1.0000 (`mcnemar-exact-binomial-two-sided`).
- Paired difference in held-back pass rate, reach minus control: +0.0 points, 95% CI [-4.1, +4.1] over 79 pair(s) (`newcombe-paired-score-95`).

## Where reach triggered

| task | status | repairs | control patch | reach patch | executable added lines | files | test lines added | visible after | regression after | held-back control / reach | bond control / reach |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| iamkun/dayjs#3180 | reach-repair-exhausted | 2 | [`d861d5bc05e4`](../../../2026-09-17/reach-pressure-experiment/patches/d861d5bc05e4af0538fd94f742f023ce55edb8b9ee4c2875f7643a629adf7dcf.patch) | [`26e3108fa4b3`](../../../2026-09-17/reach-pressure-experiment/patches/26e3108fa4b3614f6fddf9352eedd4474a4b9f3c91f8119378e78ecbca1d3831.patch) | 5 to 19 | 2 to 3 | 16 to 16 | accepted, reach unreached | pass | pass / pass | vacuous / vacuous |
| koajs/koa#1999 | reach-repair-exhausted | 2 | [`8fa2d945b255`](../../../2026-09-17/reach-pressure-experiment/patches/8fa2d945b25586963d00619a7522f5733b1e090e888c1145f5ededad2d5a08d9.patch) | unchanged | 5 to 5 | 2 to 2 | 50 to 50 | accepted, reach unreached | pass | pass / pass | held / held |
| tj/commander.js#1557 | reach-repair-exhausted | 2 | [`ecc20cc8cea0`](../../../2026-09-17/reach-pressure-experiment/patches/ecc20cc8cea042c59372beaea8bee29702b5fc67ff03889f32a7e8f20f711f37.patch) | unchanged | 27 to 27 | 5 to 5 | 34 to 34 | accepted, reach unreached | pass | pass / pass | vacuous / vacuous |
| tj/commander.js#1613 | reach-repair-exhausted | 2 | [`7288fcfd6124`](../../../2026-09-17/reach-pressure-experiment/patches/7288fcfd6124b6526446772f43b9afd5b6594a547454db8b2ec2c6259dacdf10.patch) | unchanged | 23 to 23 | 5 to 5 | 47 to 47 | accepted, reach unreached | pass | pass / pass | vacuous / vacuous |
| tj/commander.js#1671 | reach-repair-exhausted | 2 | [`24786aaecbb5`](../../../2026-09-17/reach-pressure-experiment/patches/24786aaecbb5ba0b3f4c1f2a16ee1cba242e08497fae72a315db36c7a10f287d.patch) | [`bcde89146c7a`](../../../2026-09-17/reach-pressure-experiment/patches/bcde89146c7acf40572e32a8f833e68beab69553cdc0404735751e9eb1ff1197.patch) | 16 to 16 | 6 to 6 | 54 to 54 | accepted, reach unreached | pass | fail / fail | held / held |
| tj/commander.js#1726 | reach-repair-exhausted | 2 | [`a56f2e29343e`](../../../2026-09-17/reach-pressure-experiment/patches/a56f2e29343ef4ad5b60e23e282177c8225d1c33df8d9e107de66d38d01ea3c4.patch) | unchanged | 12 to 12 | 7 to 7 | 54 to 54 | accepted, reach unreached | pass | pass / pass | vacuous / vacuous |
| tj/commander.js#1763 | reach-repair-exhausted | 2 | [`f5b2d55a0808`](../../../2026-09-17/reach-pressure-experiment/patches/f5b2d55a080871237b3c559b67c40ca5b445bd73f989b53defe45ed12faec827.patch) | unchanged | 25 to 25 | 4 to 4 | 112 to 112 | accepted, reach unreached | pass | fail / fail | held / held |
| tj/commander.js#1832 | reach-repair-exhausted | 2 | [`67db212a7758`](../../../2026-09-17/reach-pressure-experiment/patches/67db212a77588be18801c2d7652ea39b220fcf3a91ed824be29ce1640fcc5542.patch) | [`5581e919f965`](../../../2026-09-17/reach-pressure-experiment/patches/5581e919f9658cf98e9f819faa8c22d081e64c6dd87d9b3d6ac2f1b1da72cafa.patch) | 10 to 16 | 5 to 6 | 52 to 52 | accepted, reach unreached | pass | pass / pass | held / held |
| winstonjs/winston#2256 | reach-repair-exhausted | 2 | [`c5991e0e210c`](../../../2026-09-17/reach-pressure-experiment/patches/c5991e0e210c9d31499d1a4ce81854009785ae12616d0863f18984937a447ced.patch) | unchanged | 8 to 8 | 2 to 2 | 17 to 17 | accepted, reach unreached | pass | pass / pass | held / held |

What each repair did, as diff facts:

- **iamkun/dayjs#3180**: Reach named line 146 of src/plugin/timezone/index.js, the branch that still throws on an invalid string. Across two repairs the timezone plugin itself is byte-identical between the control and reach patches; the only difference is a new probe-tmp.js at the repository root, fourteen lines that load the utc and timezone plugins and print isValid() for several invalid inputs, a scratch file the agent left behind. Both patches pass the held-back oracle.
- **koajs/koa#1999**: Reach named line 305 of lib/request.js. Two repairs left the patch byte-identical to the control. Both outcomes are one patch, which passes the held-back oracle.
- **tj/commander.js#1557**: Reach named lines 47 and 48 of typings/index.test-d.ts, a tsd type-test file that no runner executes and that the reach check read as unreached source. Two repairs left the patch byte-identical. One patch, held-back pass.
- **tj/commander.js#1613**: Reach named lines 530, 563 and 567 of lib/command.js and seven lines of typings/index.test-d.ts. Two repairs left the patch byte-identical. One patch, held-back pass.
- **tj/commander.js#1671**: Reach named eight lines of typings/index.test-d.ts and nothing in lib/. The reach patch differs from the control only in the examples and test the agent had itself added: two options gain a value argument (`-b, --bar <bar>`, `-c, --cheese <cheese>`), the parsed argv gains one `sub` token, and the expected optsWithGlobals() object reads `cheese: 'sub'` in place of `cheese: true`. lib/command.js is unchanged between the two. Both patches fail the held-back oracle, which is the name-collision precedence the September evidence describes for this task.
- **tj/commander.js#1726**: Reach named lines 242 to 244 of typings/index.test-d.ts and nothing in lib/. Two repairs left the patch byte-identical. One patch, held-back pass.
- **tj/commander.js#1763**: Reach named lines 1172, 1173 and 1186 of lib/command.js and lines 85 and 86 of typings/index.test-d.ts. Two repairs left the patch byte-identical. One patch, held-back fail in both conditions.
- **tj/commander.js#1832**: Reach named lines 177 and 178 of typings/index.test-d.ts and nothing in lib/. The reach patch adds one file, tsd-check.tmp.js, seven lines that run tsd and print its diagnostics, a scratch file the agent left behind; every other file is byte-identical to the control. Both patches pass the held-back oracle.
- **winstonjs/winston#2256**: Reach named line 49 of lib/winston/container.js. Two repairs left the patch byte-identical. One patch, held-back pass.

Direction of the repair across those tasks, reach patch against control patch:

| measure | decreased | unchanged | increased |
| --- | --- | --- | --- |
| executableAddedLines | 0 | 7 | 2 |
| executableDeletedLines | 0 | 9 | 0 |
| sourceFilesChanged | 0 | 7 | 2 |
| testAddedLines | 0 | 9 | 0 |
| diffBytes | 0 | 6 | 3 |

No branch or condition count is reported: nothing in this repository parses the mined
projects' languages, and a pattern over text would be a guess.

### What reach enforcement cost

Over the 9 task(s) where it triggered, the repair phase added 18 agent invocation(s), 86.1 agent minutes, 6.0 judging minutes, 769 model call(s), 11802665 input and 46768 output tokens. The shared prefix of the same tasks took 10 invocation(s), 62.0 agent minutes, 388 model call(s), 6648492 input and 39926 output tokens. A total reads unknown where any invocation in it did not report that quantity: an unknown is never added in as zero.

### What the repairs did to the findings

The final observation against the one at the fork. Each reading is a relation between two
sets of blocking findings and two stored patches; none is a judgement of the code.

| relation | reading | tasks |
| --- | --- | --- |
| findings-grew | every earlier finding remains and at least one is new | 2 |
| findings-identical | the patch changed and the verifier names the same findings | 1 |
| patch-unchanged | the stored patch is byte-identical | 6 |

| task | fork to final | each repair | files that entered the patch | of those, by the repair's own ledger | findings named by |
| --- | --- | --- | --- | --- | --- |
| iamkun/dayjs#3180 | findings-grew | patch-unchanged, findings-grew | not recorded | not recorded | line-number, derived at analysis |
| koajs/koa#1999 | patch-unchanged | patch-unchanged, patch-unchanged | not recorded | not recorded | line-number, derived at analysis |
| tj/commander.js#1557 | patch-unchanged | patch-unchanged, patch-unchanged | not recorded | not recorded | line-number, derived at analysis |
| tj/commander.js#1613 | patch-unchanged | patch-unchanged, patch-unchanged | not recorded | not recorded | line-number, derived at analysis |
| tj/commander.js#1671 | findings-identical | patch-unchanged, findings-identical | not recorded | not recorded | line-number, derived at analysis |
| tj/commander.js#1726 | patch-unchanged | patch-unchanged, patch-unchanged | not recorded | not recorded | line-number, derived at analysis |
| tj/commander.js#1763 | patch-unchanged | patch-unchanged, patch-unchanged | not recorded | not recorded | line-number, derived at analysis |
| tj/commander.js#1832 | findings-grew | findings-grew, patch-unchanged | not recorded | not recorded | line-number, derived at analysis |
| winstonjs/winston#2256 | patch-unchanged | patch-unchanged, patch-unchanged | not recorded | not recorded | line-number, derived at analysis |

## Oracle bond, recorded and enforced by neither condition

- control patches of visible-accepted tasks: held 9, vacuous 4
- reach patches of visible-accepted tasks: held 9, vacuous 4

## Discordant pairs

### Harmful (control pass, reach fail)

None.

### Helpful (control fail, reach pass)

None.

## Left out of the paired denominator, by name

Nothing was left out.

## Limitations

- **One model.** Every trajectory is one local model under one agent loop. How a model answers a reach refusal, by deleting the lines or by making them run, is a property of the model, and nothing here says another would answer the same way.
- **How the corpus was built.** The tasks are merged pull requests that survived a viability filter which admits only what it can install and run offline, so the cohort skews toward small libraries with fast unit tests.
- **The two oracles are halves of one suite.** One author wrote both in one sitting, so they can share a blind spot, and 27 of the 79 splits hold a single case on one side. A held-back fail from a one-case half is thin evidence of incompleteness.
- **Task families are concentrated.** 14 repositories supply the 79 tasks and the largest three supply 41, so pairs are not independent draws and the interval, which treats them as such, is narrower than the truth.
- **Decoding.** No sampling parameters are sent and the server decodes greedily by default, so there is one trajectory per task and no estimate of run-to-run variance. Batched GPU inference is not bit-reproducible, so a rerun may differ.
- **The agent cannot see the visible oracle.** Reach feedback names unexecuted lines, and the only moves open to the agent are to change its own code. A setting where the agent may extend the tests would exert a different pressure.
- **Feedback travels as task text.** Repair invocations are fresh conversations that read the task and the verifier's observations in the prompt, which is how this harness repairs, and not a continuation of the earlier conversation.
- **What the workspace guard is.** The held-back half is kept out of the workspace, its git objects and every prompt. The tool policy is lexical and an allowed interpreter can still read outside the workspace, which no transcript here was audited for.
- **Reach is only as good as its coverage reading.** A transforming runner can make reach read unmeasured, and those tasks cannot trigger the treatment.

## Written after the run

**Six of the nine reach refusals named a file no runner executes.** `typings/index.test-d.ts` is
commander's tsd type test: assertions the type checker reads, which no coverage report can ever
name. Reach's test-file rule recognised `.test.ts` and not `.test-d.ts`, so it read those lines as
unexecuted source and the treatment told the model, four times with nothing else named, that lines
nothing could run had not run. That is a false refusal of the same class as the `.d.ts` one the
September evidence records, and it is fixed in `src/gates/oracle-reach.ts` after this run, with a
test. The rows above are the treatment as it ran and are unchanged by the fix; a rerun would
trigger reach on at most five of these nine tasks.

**Every triggered task ended with its repairs exhausted.** In six the patch did not change at all
across two repair invocations. In the three that changed, nothing was narrowed: one altered the
examples and test the agent had itself added, and two added a scratch file the agent had used to
probe the behaviour and did not delete. Under this model the refusal produced no pressure toward a
smaller implementation, and the held-back oracle agreed with itself on every pair.

**Generations 1 and 2** were stopped on instrument defects, named in the protocol, and their rows
are kept beside this run. No held-back verdict was produced in either.

## Re-deriving this page

    node scripts/reach-pressure-experiment.mjs analyze

reads the committed rows, calls no model and no judge, and derives this file and `summary.json` again. Where
the bytes differ from a published derivation it refuses to overwrite it and writes beside it with `--out`,
with a `derivation.json` naming what was derived with what and which values moved.
