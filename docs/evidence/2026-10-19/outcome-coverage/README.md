# Requested outcomes, thrown cases and the scope of `accepted`, 2026-10-19

Follow-up to [coverage-and-reserve](../coverage-and-reserve/README.md), on the local branch
`fix/requirement-coverage-and-verification-reserve`. Declared files and amendments:
[scope.md](scope.md). Three kinds of evidence are kept apart: **deterministic** (no model),
**replayed** (D1's recorded planner responses served by the repository's scripted endpoint through
a build's ordinary command line) and **live-model** ([protocol.md](protocol.md),
[launches.md](launches.md)).

## 1. D1, read from its own records

D1's archive was restored (`node scripts/evidence-pack.mjs restore
../coverage-and-reserve/d1/packed-derived/d1-streams`), every ledger's hash chain and blob verified,
and [../coverage-and-reserve/read-launch.mjs](../coverage-and-reserve/read-launch.mjs) over the
restored chains re-derives [../coverage-and-reserve/d1/reading.json](../coverage-and-reserve/d1/reading.json)
byte for byte; [final.patch](../coverage-and-reserve/d1/final.patch) is `sha256:a8f585bc...`, the
recorded digest.

**Requested behaviours, from the task text.** (a) a lowercase `www.` prefix links; (b) a mixed- or
upper-case `www.` prefix stays plain text; (c) a scheme of any case links, in the task's own
context, `(See hTtPS://example.com/fhqwhgads.)`; (d) with the trailing period excluded; (e)
http, https and ftp detection otherwise unchanged; (f) email autolinks keep working. The task
states (c) and (d) as kept ("must still produce a link"); the base does not give them inside text.

| check (final version) | requirement, quote | cases | what ran on the base | admission | sealed |
| --- | --- | --- | --- | --- | --- |
| `www-case-sensitive` (change) | `www-autolink-lowercase`, "a bare www autolink must start with lowercase ..." | `www.example.com` true (kept), `Www.`/`WWW.` false (changed), `example.com` false (kept) | completed; true, true, true, false | admitted (base agreement on cases 1 and 4) | yes: (a), (b) |
| `scheme-autolink-case-insensitive` (preserve) | `scheme-case-insensitive`, "Scheme autolinks must remain case-insensitive for the scheme" | `HTTP://FOO.COM` true, `not-an-url` false | completed; both agree | admitted | yes: start-of-line scheme case only, behaviour the base has |
| `https-mixed-case-link` (preserve) | `scheme-case-insensitive`, the whole sentence with `(See hTtPS://...)` | that input, true | **every call threw a `TypeError` in the check program** | dropped as "disagrees with the base", input named by the task | no: (c) and (d) |
| `email-autolink-preserve` (preserve) | `email-autolink-preserves`, "keep email autolinks working" | `foo@bar.baz` true, `not-an-email` false | completed; both agree | admitted | yes: (f) |

**The exception.** `https-mixed-case-link`'s program is
`return '<a href="https://' in result || 'href="http://' in result;`, Python's substring test.
Its recorded stderr (`sha256:386d0e8e...`, every admission round): `TypeError: Cannot use 'in'
operator to search for '<a href="https://' in <p>(See hTtPS://example.com/fhqwhgads.)</p>`, at
`.swarm-check-93515.mjs:5:30`, the program module's own `in` expression, called from the runner.
So it occurred in **adapter code, after loading and after the repository call returned**: the
module loaded (the runner did not exit 3), there is no fixture, and the message carries what
`marked.parse` returned, which is the input as plain text, with no link. The runner caught it and
printed `{"threw":true}` with exit 0, and admission compared that line with the expected
`{"result":true}` and read a disagreement with the base on an input the task names. The first
version of `email-autolink-preserve` had the same defect (round 1); the planner replaced it after
the in-loop feedback, and did not replace this one. A first version of the scheme check had quoted
the example sentence too, and was replaced by one quoting only the general rule, so the sealed
requirement's quote no longer held the example either.

**What reached the worker.** The revision was withheld (52.9 s left, 97.5 s needed). Coverage,
reconciled per requirement, counted `scheme-case-insensitive` covered by the retained
`scheme-autolink-case-insensitive`, so `uncovered` was empty, the brief had no section, and the
report and JSON named nothing.

**What `accepted` meant.** `outcome.status: accepted`, exit 0, is `outcomeStatus`: the verdict was
acceptable (every blocking gate passed: build, lint, tests, `task-acceptance` judging the supplied
visible check, `task-diagnostics` running the three retained generated checks, which agreed, and
the final independent verification passed) and every *supplied* requirement (`visible-check`) was
met. Planned requirements are unjudged by design and decide nothing. So it was the supplied
contract's acceptance with gates, diagnostics and the final verification, never a reading that the
task was done, but the line said only `accepted` and nothing named the lost outcome.

## 2. D1 replayed through each build (no live model)

[d1-replay.mjs](d1-replay.mjs) serves D1's 40 recorded planner responses in order, each held for its
recorded response time, through the repository's scripted endpoint; the build runs its ordinary
command line, with D1's flags, on a workspace the comparison runner's own helpers prepare from D1's
frozen manifest, and admission runs the recorded programs on a real checkout of the marked base. A
revision or review round D1 never had would be answered by a turn that declares nothing (none was
asked for). **Disclosed adapter:** the worker's 40 steps are not replayed; it declares
marked's tokenizer source file and writes D1's delivered version of it whole, so the final checks run on D1's exact
patch (digest compared). This is a focused reproduction of planning, admission, the brief, the
final checks and the report, not of the worker's search.

Results ([replay/](replay/); each file is the script's summary, with the build's own records):

| | D1 (recorded) | replay, D1's build `9a5052750` | replay, this work `b148573e3` |
| --- | --- | --- | --- |
| planner turns played | 40 | 40 of 40 | 40 of 40 |
| `https-mixed-case-link`, final round | disagrees with the base, input named | the same | **`raised-in-program`**, case 1 thrown in the check program |
| `email-autolink-preserve`, round 1 (same `in` defect) | disagrees with the base | the same | `raised-in-program`, both cases |
| admission decisions, every round | | identical to D1's reading | as D1 but for those two findings |
| revision | withheld, 52.9 s left, 97.5 s needed | withheld, 53.1 s, 97.1 s | withheld, 53.6 s, 96.9 s |
| per-requirement `uncovered` | none | none (identical reconciliation) | none |
| outcomes recorded before admission | | | 5 ([d1-build-b148573e3.json](replay/d1-build-b148573e3.json)) |
| unresolved outcomes | | | **`scheme-case-insensitive#1`**: the example's sentence, kept behaviour; `scheme-autolink-case-insensitive` declared again with other words, `https-mixed-case-link` thrown in its program, no revision |
| worker's brief | no section | no section | names it, with why and the next action |
| report and JSON | `accepted`, nothing named | the same | `accepted; this is the supplied contract's reading only: 1 requested outcome(s) ... does not show the whole task done`, `NO CHECK` under the requirement, `plannedChecks.unresolvedOutcomes` and `outcome.unresolvedOutcomes` |
| exit, final checks | 0; build, lint, tests, acceptance, diagnostics, independent verification passed | the same, on D1's exact patch | the same, on D1's exact patch |

So on D1's recorded evidence the controller now refuses the throwing check as a broken
observation rather than a base disagreement, keeps the example's outcome unresolved though its
requirement reads covered, carries it to the brief, the report and the JSON, and scopes
`accepted`. It does not write a check for the example: the revision is still withheld for time,
and the replayed planner, being a recording, does not react to the new in-loop feedback. Whether a
fresh model given that feedback and that brief delivers a correct patch is what section 5 tries
once.

The replay is sensitive to load: a first run of it on D1's build beside the clean-clone gates of
section 4 played only 36 of the 40 recorded turns before the planning share ran out, and sealed a
different declaration ([d1-build-9a5052750-under-load.json](replay/d1-build-9a5052750-under-load.json),
kept as a record, not as a replay). The rows above are runs with nothing else running; the quiet
rerun on D1's build reproduced D1's decisions and reconciliation exactly, as the first quiet run
did.

## 3. What changed

- **A thrown case says where it was thrown.** The runner reads the innermost stack frame that names
  a file: the check program's own module (`thrownIn: "check-program"` on the line), no file frame
  (`"unattributed"`), or anywhere else, the project, which keeps the plain `{"threw":true}` a
  declared throw expects. A case thrown in the program recorded no answer of the project's, so
  its check is refused as `raised-in-program` with what it printed, for the existing revision and
  in-loop feedback; a relation counts such calls. A project's throw stays an observation (a
  declared throw met, or a diagnostic of a crashing base); an unattributed one is read as the base's
  answer with the uncertainty noted. This is where it was raised, not whose fault it was: a program
  passing a wrong argument gets the project's throw, and a project that hides its frames with
  `Error.captureStackTrace` moves the frame to its caller.
- **An outcome cannot disappear behind a sibling.** Each declared check records the task's words
  it quotes; an outcome is (requirement, those words, change or keep). Every outcome a
  declaration names is kept once named, recorded before admission (`planned-outcomes-v1`), and
  reconciled after admission and the revision (`planned-coverage-reconciled-v2`): covered only by
  a retained check whose latest version still states it. One with none is unresolved, with every
  check declared for it, why it does not state it now and the next action, in the revision's
  brief, the worker's brief, the report and the JSON (`plannedChecks.unresolvedOutcomes`,
  `outcome.unresolvedOutcomes`).
- **`accepted` is scoped.** With any unresolved outcome, the status line says it is the supplied
  contract's reading only and does not show the whole task done. Status and exit code are
  unchanged; no verifier semantics changed.

The identity is the planner's own: two outcomes it put in one quote with one role are one (in D1,
(c) and (d) share the example's sentence and are one outcome), and one it never stated is not
tracked. Nothing here reads whether an expectation is right, and literal mentions are not used as
an oracle.

## 4. Verification before the launch (deterministic and scripted-model)

[verification.md](verification.md): `npm run gates`, `build`, `check:packaged` and `fuzz:build`
all exit 0 on `b148573e3` in a clean full-history clone; 4,541 tests pass and 29 are skipped, the
same skips as before, with 16 new tests. [regressions-before.md](regressions-before.md): all 17 new
or extended regressions fail on the starting implementation `3e99b6305`; of the nine thrown-case
ones, five fail on behaviour (including two false admissions there: a throw in the check program
meeting a declared throw, and a relation whose program throws everywhere reading as holding) and
four only on the new record field, behaviour deliberately kept.

## 5. One development launch (live-model)

Registered in [protocol.md](protocol.md) before it started, entered in [launches.md](launches.md),
run by the comparison runner unchanged from a fresh clone of the task's base with D1's limits and
nothing but the task and the visible check given. Records: [launch/record.json](launch/record.json),
the exact [launch/final.patch](launch/final.patch), and the stdout, stderr, oracle output and both
session chains packed losslessly in [launch/packed-derived/launch-streams](launch/packed-derived/launch-streams/);
[launch/reading.json](launch/reading.json) is [read-launch.mjs](read-launch.mjs) over those chains
and re-derives identically from the restored pack.

| reported separately | result |
| --- | --- |
| requested outcomes represented | yes: 11 outcomes recorded before admission; 7 unresolved after it, every one named in the brief, the report (with the fix of scope amendment 1, the example's own words too) and the JSON |
| relevant checks executed correctly | no case threw. The scheme check's program matched `href="https:` in lower case, which a correct implementation (it keeps `hTtPS`) also fails; its cases moved to angle-bracket inputs the base fails too; refused, no check of the example survived |
| final verification completed | yes, on the delivered tree: build, lint, tests, `task-acceptance`, `task-diagnostics`, independent verification (69.3 s of a measured 106.2 s reserve) |
| delivered patch, hidden oracle | **fail** |
| report matched the evidence | yes in scope: `accepted` (exit 0) is labelled the supplied contract's reading, with 7 outcomes exercised by no check; the two the oracle fails on are among them. The terminal report showed the example's outcome only by its requirement's words (fixed after the launch, amendment 1) |
| wall, tokens, repair | 460.6 s agent wall (planning 271.8 s, seal 26.9 s, worker 92.3 s, final 69.3 s); 1,879,551 tokens (planning 1,177,097); no repair ran |

**What the patch does** (confirmed on a fresh checkout with it applied, as a diagnosis; the
frozen oracle's verdict stands): `Www.example.com` stays plain, `www.example.com`, `foo@bar.baz` and
`HTTP://FOO.COM` link, `hTtPS://example.com/fhqwhgads.` at the start of a line links without the
period, but `(See hTtPS://example.com/fhqwhgads.)` does not link (the inline-text rule is
untouched, D1's miss), and `ftp://example.com/file` no longer links at all: the hand-written scheme
class reads `[fF][pP][tT]`.

**First concrete failure.** In planning, the first scheme check wrapped its inputs in `(See ...)`
and the base answered no link for the task-named example; admission recorded the disagreement and
said the task names the input, so the outcome may be the one it asks for. The planner then declared
the check again as a change but with the base's answer as its expectation (`hasLink: false`), which
the base passes, so it was refused as not detecting the change; it then moved the cases to
angle-bracket inputs, which the base also fails, and the revision was withheld. The example's
outcome reached the worker as unresolved, with "run the project on the task's own example
yourself"; the worker did, saw `(See hTtPS://...)` give no link, attributed it to angle-bracket
autolinks and finished with about six minutes of the launch's wall unused. The `ftp` regression sits under another
unresolved outcome the brief named ("without changing how http://, https:// or ftp:// are
detected"), which nothing checked.

So this launch did not deliver a correct patch. The changes of this work kept the requested
outcomes visible and scoped the report; they did not get a check of the example written, and a
named, unresolved outcome in the brief did not stop the worker from finishing past evidence it had
itself produced. Several of the seven unresolved outcomes are the planner's rewordings or a first
declaration with no quote (`email-autolinks#1`, `www-case-sensitivity#4`): identity by quote
fragments when the planner rewords, which adds noise to the brief.

## Remaining limitations

- Outcome identity rests on the planner's quotes and case roles; a planner that quotes one sentence
  for two behaviours, or misstates a role, merges them.
- Where a throw was raised is not why: a program that passes the project a wrong argument reads as
  the project throwing, and a project hiding its own frames reads as the program throwing.
- The revision's fixed minimum still withholds it when the first round uses its share (D1, the
  replays and the launch); the unresolved outcome then reaches the worker, but no check is
  written for it.
- An unresolved outcome is information for the worker, not a gate: the launch's worker read it,
  observed the example failing, and finished anyway.
- Identity by quote fragments under rewording: the launch reported 7 unresolved outcomes, some of
  them restatements of covered ones or a first declaration with no quote.
- `accepted` keeps its meaning (the supplied contract); only its wording is scoped.

## Corrections appended 2026-10-20

Read again from the restored chains in [../requested-example/](../requested-example/README.md)
section 1; the launch's results above stand.

- The worker's brief was misleading as well as incomplete: its sealed "Required behavior" described
  `scheme-insensitivity` as "mixed case schemes in angle brackets still produce links", the last
  version's description, while the task's example appeared only among the unresolved outcomes.
- `www-case-sensitivity#4` was not a declaration with no quote: it quoted a longer form of the
  sentence `#3` quotes. `email-autolinks#1` was the one with none.
- The revision was withheld at 64.2 s left of a 336 s planning allowance while the whole run still
  had 568 s to its deadline; whether a revision would have produced a correct check or patch is not
  established.
- The 16ec1a7e6/b470b55e2 work that follows reads the bundle-verifier failure of a run whose last
  attempt was rolled back as a verifier defect; this launch's bundle verified, since its last
  attempt was not rolled back.
