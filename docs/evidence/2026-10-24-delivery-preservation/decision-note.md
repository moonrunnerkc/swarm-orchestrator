# Decision note: close the delivery and preservation workflow

October 24, 2026, written before any implementation of this stage. The starting implementation is
PR #101's head, `40e3f17a5`, which is still open and unmerged. I verified that the worktree,
the remote branch and the PR head all name it.

Each finding below is labelled by what establishes it:
- **records**: the published session ledgers of PR #101's studies;
- **isolated**: a direct call of the current function;
- **code**: reading the path end to end.

None of it rests on a new live run.

## A. A candidate with only inherited lint was refused

**Records.** Confirmation round 2, ufo bug fix, `swarm` (ledger under
`~/.cache/swarm-study-2026-10-23c/confirm-2/runs/sessions/ufo-bugfix-base-prefix-boundary.swarm`):
- The settled cycle's lint run (record 474) prints only `src/punycode.ts`, exactly what the base
  run (record 237) prints.
- The final independent verification (record 635) reads lint `inherited` and regression `pass`.
- The run assessment (record 636) is `acceptable: false`, with reason
  `the gates settled escalated; blocking gate(s) failed: lint`.

**Code.** The cause is two definitions of "inherited" and one requirement:
1. **The loop requires an absolute pass.** `isGreen` (`src/gates/gate-runner.ts:191`) requires no
   blocking failure, so a blocking check that fails as on the base keeps the loop from settling
   green.
2. **The loop has its own inheritance test.** `failuresTheBaseHas` (`src/gates/auto-resolve.ts`)
   decides "fails at the base" by whole-output `failureSignature`, measured once, against the
   first cycle only. The first candidate had added two prettier findings, so the escalation
   records `failingAtBase: []` even after repair removed them.
3. **Verification reads it the other way.** The final independent verification uses
   `attributeFailure` and reads the same failure as inherited.
4. **So do the verdict and the verifier.** `runVerdict` (`src/evidence/verdict.ts`) and the
   bundled verifier (`verify.mjs`) refuse any blocking failure, so the verdict, the exit code and
   the offline re-derivation all agree with the loop. They disagree with the regression reading
   printed beside them.

## B. Review was withheld while an unrelated gate failed

**Records.** In all six revised-Swarm fresh-block launches and all `swarm` confirmation launches,
the review records `withheld: the gates were not green when the attempts ended`.

**Code.** The hook is asked only under `isGreen(cycle)` (`src/gates/auto-resolve.ts:337`). A
failing lint gate therefore withholds semantic review, though nothing about lint stops the
candidate from running.

## C. Development probes failed to load, and the three findings were wrong

**Records.** These are the examination records of the development study.
- **Thirteen did-not-load cases.** The markdown-it probes are TypeScript
  (`(input: { src: string }) =>`, `const env: any`). The runner writes every program to a `.mjs`
  file, so none could load.
- **The recorded error lost its message.** `src/cli-review.ts` keeps the last 600 characters of
  stderr. For a load failure that is the bottom of the stack (`uleStrategy (node:internal/...)`),
  so neither the reviewer nor the record saw why.
- **No way to try a probe first.** The reviewer had no tool to run a probe before submitting
  it.
- **The did-not-complete case.** The program printed to stdout, so the runner's lines were not
  one answer per case.

**The three established findings were false:**
- **`render-identical-with-deferred-tokens`** (markdown-it, preservation-regression).
  - The probe calls `md.core.ruler.disable('strip_references')`, a rule the task adds. On the base
    it throws, and the classifier took the base's `{"threw":true}` as the expectation.
  - The candidate's answer equals the reference's.
  - A base that raises for lack of the requested API is the feature's absence, not behaviour to
    keep.
- **`whitespace-in-scheme`, cases 1 and 2** (svgo, missed-requirement). The expected answer was
  written by the model, and the base, the candidate and the reference all give the other answer.
  A model's reading of the task was treated as an established requirement.

## D. Preservation accounting

**Isolated:** `npx tsx` over `src/gates/preservation-obligations.ts`, script in the stage's
`reproduction/` directory. All four claims hold at `40e3f17a5`:
- **`All public exports must remain available.`** It is not extracted: the keyword pattern has
  no `remain`.
- **More than twelve.** Fourteen keep sentences yield twelve obligations: `.slice(0, 12)` drops
  the rest without a trace.
- **A new feature reported as preserved.** A supplied requirement for a new `filterQuery` is
  recorded as an authoritative preservation obligation and settles `kept` once accepted.
- **A quote standing for the whole obligation.** A probe quoting half a sentence, with one
  passing case, settles the whole sentence `kept`.

## E. Comparison scoring

**Code.**
- **Added lint.** `scripts/comparison/checks.mjs:170` sets
  `introducedFailure: applicable && atBase.exit === 0 && delivered.exit !== 0`. Where the base
  fails lint, an added finding can never count against a delivery. `score-study.mjs` inherits
  that.
- **Test sensitivity.** `score-study.mjs` reads requested tests as sensitive where
  `onBase.status !== 0 && delivered.status === 0`. Any nonzero exit on the base counts:
  - a test file that cannot import the new export;
  - a runner that collected zero tests;
  - a load error.

  None of those executes an assertion against the base's behaviour.

## Smallest changes

1. **One requirement policy** (`docs/check-requirements.md`, sealed in this commit before any
   code):
   - every gate is `absolute-pass` or `no-new-regression`, recorded on the seal;
   - the loop's green, repair eligibility, escalation, verdict, exit code, report and bundled
     verifier all read failures through `attributeFailure`;
   - `failuresTheBaseHas`'s signature comparison is removed, not kept beside it;
   - `failure-identity-v4` adds diagnostic identities for ESLint, Prettier and tsc, a
     short-circuited `&&` chain and exit 128 as incomplete, with the independent mirror in
     `status.mjs`.
2. **Review eligibility.** Review may run once the change was executed and every blocking failure
   is a static check (lint, format, typecheck, build), not only when green.
3. **Review mechanics.**
   - The load error keeps its message.
   - The reviewer gets a bounded `try_probe` tool that runs a program on a copy of the candidate,
     and is told programs are plain JavaScript.
   - A base that raised is a change, not a regression.
   - An expectation the model wrote stays provisional.
   - A regression is established only where the probe names an authoritative keep obligation.
   - Only established findings reach repair, with input, expectation, observation, program,
     authority and candidate digest.
   - Only authoritative kept cases are held by the ratchet.
4. **Preservation accounting v2:**
   - requested, explicit-preserve, observed and proposed obligations kept apart;
   - every task sentence retained, either as a keep obligation or as unresolved task text, with
     no count limit and a stated extraction limit;
   - supplied requirements counted as preserved only where marked so;
   - examples report `exercised`, never the whole obligation `kept`;
   - each claim records its check, input, base and candidate observations and the delivered
     artifact digest.
5. **An appended audit of PR #101's studies.** It never edits their scores. It applies the
   stricter lint and test-sensitivity readings to every arm, from its own implementation rather
   than the product's.

Nothing here adds a controller, a planning framework or a flag beyond the per-gate requirement
already expressible in `swarm.toml`.
