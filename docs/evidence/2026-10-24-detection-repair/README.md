# Detection and repair stage, October 24, 2026

This stage asked whether Swarm can detect a real defect in a candidate and repair it into a better
delivered artifact. It started from PR #101's remote head, `ef5e87efc`, and declared its files
before editing ([intended files](intended-files.md)). It adds no controller and no general
mechanism: it changes the failure reader, the review's probes, and what the review may establish.

## 1. Two failure-attribution gaps, closed (`failure-identity-v5`)

**Reproduced first, at the reader and then through the product.** The reproduction used real
ESLint 8.50 and Prettier 3.9 through the ordinary command line, a scripted model, the gates, the
final verification and the bundle's verifier ([`reproduction/`](reproduction/)):

| Case | Before (`ef5e87efc`) | After |
| --- | --- | --- |
| A. `eslint src && eslint test`: the first command fails, so the second never runs. The change adds a `var` under `test/` | accepted; final verification `pass`; bundle verifies | stops before model spending: the chain stopped before its last command |
| B. The base's `no-var` on line 2 is fixed, and an identical one is added on line 6 of the same file | accepted; final verification `pass` | refused; the unaccounted occurrence is named (`legacy.mjs:6:3`) |
| C. Prettier control: a misformatted statement is added to an already-failing file | accepted | refused: a file-level finding in an edited file is unattributed |
| D. The task says "Fix the ESLint error in src/legacy.mjs", and the change leaves it | accepted as an inherited failure | refused: the lint gate is sealed `absolute-pass` with the sentence on the seal |
| E. Control: the base's error left exactly as it was | accepted | accepted, inherited (unchanged) |

**The final verifier did not prevent either gap.** Before the fix, every case's final verification
read `pass` and every bundle verified.

**The fix** ([policy](../../check-requirements.md#failure-identity-v5)):
- **Chains.** An echoed `&&` chain is complete only where no earlier command runs the failing
  tool.
- **Located diagnostics** (ESLint, tsc) are inherited only as base occurrences that the change's
  recorded zero-context hunks carry to the same line and column (`sourceChanges`, recorded on the
  gate run and the final verification's check). A file-level Prettier finding is inherited only in
  an unchanged file. Anything else is unattributed. The harness abstains rather than guess at a
  move.
- **A static failure the task asks to fix** seals that gate `absolute-pass`. The rule is lexical,
  and it fires on none of the ten earlier held-out task texts.
- **The offline verifier** (`status.mjs`) mirrors v5, and v4 records keep their v4 reading.
- **The live-validated case stays accepted.** ufo's base fails Prettier on `src/punycode.ts`,
  which the change leaves untouched, and that is still inherited.

## 2. The false acceptance, traced

[`trace/`](trace/README.md) reconstructs the October 24 feature false accept from its records.
This is exposed development evidence, and no model receives it.
- **The three failures.** Two are reconstruction of `file:///C:/x?...`, rebuilt as given rather
  than as `withQuery` rebuilds it. The third is the predicate asked twice about the first key.
- **All three date from the worker's first version.** No later edit touched them.
- **Nothing that ran had an input where they show.** The worker's tests had no `file:///...?`
  input, and the visible check has one case.
- **The worker's own test caught the third failure,** three times. The worker then deleted that
  test before any gate cycle, so no gated version held it.
- **The review.** It was asked once. Its only trial used `require` and did not load. Both admitted
  probes imported `./src/index.js` from a TypeScript project and never loaded, and the two
  dropped probes would not have reached these inputs either.

## 3. Probes that run (`project-loader-v1`, admission runs)

- **The loader.**
  - **How it chooses.** The harness tries the ways the project can be loaded, on a copy of the
    base, and keeps the entry that exposes the most of the names the task's code calls. It tries
    the entry the task names, the files the change edits, then the manifest and the usual
    entries, through a TypeScript loader the project installed and then Node's own.
  - **What the reviewer gets.** Those loading lines, and the exports they exposed.
- **Admission runs.** The harness runs every submitted probe once before it counts, whether or
  not the reviewer tried it. The reading is one of:
  - load failure;
  - probe failure;
  - project exception;
  - observation.
- **One correction.** A broken probe goes back once with its error. Still broken, it is
  `unmeasured`, never "nothing found".
- **Trial reuse.** A `try_probe` trial is reused only where program, inputs, tree, candidate
  patch and environment all match.
- **Recorded strings are scrubbed in full.** Admission now scrubs the check ids a probe's runs
  get (`<id>-ref-run-2`), which the October 24 fix did not reach.

## 4. Requested behaviour measured apart from preservation (`task-code-v1`, `candidate-review-v3`)

- **The task's own code, run by the harness.** The harness reads examples and relations the task
  writes as code, and runs them on both trees with no model:
  - `call is literal` is requested;
  - `call stays literal` is kept;
  - `today call returns literal` describes the change the task asks for, and is never held;
  - `callA equals callB for every input that contains "S"` is a relation. `callB` runs on the
    unchanged base, so the expectation is the existing function's.

  A relation's inputs are the task's own literals in that position. Literals outside the stated
  domain are carried into it.
- **Prose requirements** can reach a measurement only as a reviewer's relation probe:
  - its reference may call only functions the quoted words name;
  - a difference counts only where the relation held on some input.
- **What is established, and what follows.** Established findings are the preservation
  regression (as before), a requested example the candidate misses, and a relation it breaks.
  Each earns one repair attempt under the ratchet, and the cases are held as parts.
- **The obligations.** The task's code statements are obligations from the start: requested,
  kept, or a relation measured only at its inputs. Each is settled only by what ran on the
  delivered candidate.

## 5. Development set and scripted mechanics

[`development/`](development/README.md) holds nine retained candidates over ufo, svgo and p-limit:
- six defective;
- three correct, one of them with the behaviour change its task authorizes.

Each was validated against its task by the sealed evaluator, apart from the product. All six
defective candidates fail it, and all three correct ones pass.

**Scripted mechanics on the real trees** ([`scripted-mechanics.json`](development/scripted-mechanics.json)):

| Case | Finding | Attempt | Delivered | Hidden: start, delivered |
| --- | --- | --- | --- | --- |
| D1, ufo feature | the task's relation, at `file:///C:/x?...` | given, kept | the repair | fail, pass |
| D2, ufo feature | the task's relation, two inputs | given, rolled back (the scripted repair removed tests) | the start | fail, fail |
| D4, ufo bug fix | kept behaviour, under the task's keep sentence | given, kept | the repair | fail, pass |
| C1, ufo feature | none | none | the start | pass, pass |
| C2, ufo bug fix, authorized change | none; the changed answers read as requested and met | none | the start | pass, pass |

**Two product defects this found and fixed.**
- A relation's carried inputs came last and were cut at six, so D1's counterexample never ran.
- The review reported a rolled-back candidate's readings as the delivered one's.

## 6. Live: development run, matched study

The [development protocol](live/development-protocol.md) and the
[matched protocol](live/matched-protocol.md) were registered before any live launch.

### Development run (build `f48188bfb`, one launch per case, `swarm` only)

[`live/development-run/launches.json`](live/development-run/launches.json):

| Case | Established at examination | Attempt | Hidden: start, delivered | Product | Wall | Tokens (review) |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | 6 relation cases, `file:///C:/x?...` | given, kept | fail, **pass** | accepted, correct | 445 s | 1.41M (0.20M) |
| D2 | 2 relation cases, `/foo?` and `file:///C:/x?` | given, kept | fail, **pass** | accepted, correct | 298 s | 1.17M (0.21M) |
| D3 | 2 relation cases, a valueless key (`/x?bar`) | given, kept, did not fix them | fail, fail | **accepted, wrong** | 286 s | 0.37M (0.20M) |
| D4 | none: the reviewer's probes did not reach the inputs where the base is absent | none | fail, fail | accepted, wrong | 148 s | 0.19M (0.19M) |
| D5 | none: a prose requirement, and the reviewer submitted no probe | none | fail, fail | accepted, wrong | 103 s | 0.18M (0.18M) |
| D6 | review withheld: the gates' own repairs used the budget first | none | fail, fail | refused, correct | 616 s | 2.44M |
| C1 | none | none | pass, pass | accepted, correct | 153 s | 0.16M (0.16M) |
| C2 | none; all four reviewer probes failed to load, and the correction returned new ids | none | pass, pass | accepted, correct | 180 s | 0.29M (0.29M) |
| C3 | none | none | pass, pass | accepted, correct | 75 s | 0.13M (0.13M) |

**Two complete live chains** (D1, D2). The observation and the code change, D1:
- **Observation.** The task states `filterQuery(input, () => true) equals withQuery(input, {})
  for every input that contains "?"`. The harness carried the task's own `file:///C:/x` into that
  domain. For `file:///C:/x?bar=1&baz=2`, `withQuery` on the unchanged base gives
  `file://C:/x?bar=1&baz=2`, and the candidate gave `file:///C:/x?bar=1&baz=2`.
- **The code change.** The repair replaced the candidate's string slicing
  (`input.slice(0, queryIndex) + "?" + ...`) with a rebuild through `parseURL`, `parseQuery`,
  `stringifyQuery` and `stringifyParsedURL`, as `withQuery` does. It asks the predicate once per
  key.
- **The result.** All three hidden failures pass on the delivered tree. The third, the predicate
  called twice, the review did not find: it was fixed by the same rewrite.
- **D2.** The same shape: `/foo?` and `file:///C:/x?` kept their `?`, and the repaired rebuild
  drops it, as `withQuery` does.

**What failed, in order along the chain:**
- **D3.** The finding was right. The repair did not fix those cases and was still kept, because
  nothing it held regressed, and the run was accepted with the relation reported `unmet`. A
  finding never decides acceptance.
- **D4, D5.** Detection. The harness's own code does not reach these defects, and the reviewer's
  probes did not.
- **D6.** Budget: the review was never asked.
- **C2.** Admission dropped every corrected probe because the reviewer changed their ids. This is
  fixed in `2920baf44`, along with an empty optional field that dropped a D1 probe. The matched
  study runs on the build that carries those fixes.

**No correct candidate was accused** (C1 to C3), and C2's authorized change read as requested and
met.

### Matched study (build `5ec569c70`, registered, sixteen launches)

[`live/matched/launches.json`](live/matched/launches.json),
[`live/matched/audit.json`](live/matched/audit.json); records packed under `live/matched/`.

| Arm | Probes run (broken) | Defects found (of 4 defective starts) | False accusations (of 4 correct starts) | Attempts given, kept | Hidden pass (strictly complete) | Accepted, of them wrong | Wall | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `swarm` | 19 (0) | 2 (D1 twice; D4 never) | 1 (C2) | 3, 3 | 4 / 8 (4 / 8) | 8, 4 | 1,665 s | 2.91M |
| `swarm-control` | none | none | none | 0, 0 | 4 / 8 (4 / 8) | 8, 4 | 498 s | 0.004M |

The audit agrees with the hidden verdict on all sixteen launches. Every control launch delivered
its starting candidate unchanged.

- **D1, both `swarm` samples.** The review established the same six relation cases as in the
  development run (`file:///C:/x?...`). The repair was given and kept, and the delivered tree
  holds all twelve relation inputs. The hidden check still fails, on two cases the review never
  established:
  - **The predicate asked twice.** Both repairs kept the candidate's "any key kept?" first pass. A
    prose requirement, which no probe reached.
  - **`/foo#h?bar=1` rebuilt wrongly.** It is inside the relation's domain ("contains `?`"), but
    not among its inputs, which are the task's literals and those carried into the domain.

  The improvement is real but partial: the established cases are fixed, and the artifact is not.
- **D4, both samples.** The reviewer's preserve probes, eleven cases, all kept the base's answer.
  None used a base the input does not start with, where D4 breaks `withBase`.
- **C2, sample 3. A false accusation.** The reviewer named `task-keep-2` and called the answers
  that sentence asks for a regression. The sentence is "When it is not present, withBase joins the
  base ... and withoutBase returns input unchanged (...)", whose keep wording is "unchanged" and
  whose own code examples are all requested.
  - **Cost.** One attempt (0.35M tokens of review). The repair left the code correct, and the
    delivered tree still passes.
  - **Corrected after the block** (`0282bfc7c`). A keep-worded sentence whose code examples are
    all requested or today's is no longer a keep authority. The block ran without the
    correction.

**First concrete failure along the chain:** the repair completed what the review established, and
not what it did not establish. The detection reached only the cases written in the task's code.

**The stop rule applies.** No `swarm` launch on D1 or D4 delivered a tree that passes the hidden
check where its start failed, and one correct start was accused. There is no expansion and no
fresh comparison. Nothing was added during the block.

## Answers

1. **What real defect did Swarm discover?**
   - **ufo `filterQuery`, live.** It rebuilt `file:///C:/x?...` as given instead of as `withQuery`
     rebuilds it, and kept the `?` of `/foo?`. Found by the harness's run of the task's own
     relation, carried into its domain: development D1 and D2, and matched D1 twice.
   - **ufo `withBase` breaking kept behaviour (D4).** Found in scripted mechanics only, never live.
2. **What correct code did it produce because of that discovery?** In the development run, twice:
   - the repair rewrote `filterQuery` to rebuild through `parseURL`, `parseQuery`, `stringifyQuery`
     and `stringifyParsedURL`, as `withQuery` does, with one predicate pass;
   - the hidden check went from fail to pass on D1 and on D2.

   In the matched study the same finding produced repairs that fixed the established cases and
   not the artifact (hidden fail, both samples).
3. **What existing behaviour did it measure and preserve?**
   - The task's kept examples: `withQuery("/x?bar", {})` and two more, and six `withBase` and
     `withoutBase` cases. Each was held on every delivered candidate.
   - The reviewers' preserve probes, which all kept the base's answers, apart from the one false
     accusation.
   - The hidden kept check passed on every delivered tree whose start passed it. D4's
     preservation defect was never repaired live.
4. **Did the improvement repeat and transfer?**
   - **Detection repeated** on the same ufo task: four of four launches on D1 and D2 starts.
   - **The complete repair did not repeat:** two of four.
   - **It did not transfer** to the bug-fix candidate (D4), to svgo (D5) or to p-limit (D6), whose
     requirements the task states in prose.
5. **How did it compare with the control and any external agent?**
   - Against its ablation, the matched study shows equal artifact correctness (4 of 8 each) and
     equal verdict accuracy (4 false accepts each).
   - It cost 3.3 times the wall and 2.9M more tokens.
   - No external agent was run: the stop rule withheld the fresh comparison.
6. **The full cost and remaining limitations.**
   - **Cost.** The live development run took 2,304 s and 6.33M tokens; the matched study 2,162 s
     and 2.92M tokens. All local, and the paid inference was $0.
   - **Limits:**
     - detection reaches only requirements written as code, or ones a reviewer's relation probe
       targets;
     - a finding decides nothing, so an unrepaired one still lets the run be accepted (D3, a
       false accept);
     - a relation's inputs are a small sample of its domain;
     - the review can be withheld when the gates' own repairs spend the budget (D6);
     - every result here is development evidence on exposed tasks, with one local model and two
       samples a cell.
7. **Where everything is.**
   - The commits on PR #101, after `ef5e87efc`.
   - The [reproduction](reproduction/) with real tools, before and after.
   - The [trace](trace/README.md) and the [development set](development/README.md).
   - [Scripted mechanics](development/scripted-mechanics.json).
   - The [live development run](live/development-run/launches.json) and the
     [matched study](live/matched/launches.json).
   - The session archive on `evidence/2026-10-24-detection-repair-sessions`
     (`detection-repair-sessions.tar.xz`, sha256
     `b6efb872c894ba0fe5d868f488da935b23944d84f0a804b7c993fbb570b9f7cf`).
