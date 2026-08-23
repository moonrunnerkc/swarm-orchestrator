# Security coverage

What has actually been examined in this repository, what was found, and what is deliberately
not covered. Written to be audited rather than believed: every claim below names the tool,
the version, the scope, and the evidence, and anything not verified says so.

Scope of this document: the v13 lineage (`v13-main` and its descendants). The `main` branch
is a separate, unrelated history (swarm-orchestrator@12.1.1, a PR auditor) and nothing here
applies to it.

Last updated 2026-08-18. Findings are as of the hardening pass described below, plus the
production-readiness pass whose report is in `evidence/2026-08-18/`. A weekly scan now
re-verifies part of this on a schedule; what it does and does not cover is in
[Not yet in place](#not-yet-in-place).

## What was examined, and how

### Static analysis

Semgrep 1.136.0, `p/default` (213 rules), against `src` with `*.test.ts` excluded from
scanning. 117 files, ~100% parsed. **7 raw findings: 3 WARNING, 4 INFO.**

Sixteen other rule packs were run standalone against the same scope. Every one loaded real
rules and returned **zero** findings:

| pack | rules | findings | pack | rules | findings |
|---|---|---|---|---|---|
| p/gitleaks | 174 | 0 | p/security-audit | 23 | 0 |
| p/owasp-top-ten | 80 | 0 | p/r2c-security-audit | 23 | 0 |
| p/javascript | 74 | 0 | p/xss | 12 | 0 |
| p/typescript | 74 | 0 | p/insecure-transport | 8 | 0 |
| p/cwe-top-25 | 44 | 0 | p/jwt | 6 | 0 |
| p/secrets | 41 | 0 | p/eslint-plugin-security | 6 | 0 |
| p/nodejs | 36 | 0 | p/react | 4 | 0 |
| p/trailofbits | 26 | 0 | p/command-injection | 2 | 0 |

`p/github-actions` was run against `.github` (11 rules, 0 findings). `p/supply-chain` is not
a registry pack; Semgrep Supply Chain is a separate product.

These are null results from rules that ran, not from rules that failed to load. They are
weak evidence of safety and strong evidence about **pack choice**: the packs that found
nothing are aimed at web applications (SQL injection, XSS in templates, session handling,
transport), and this codebase is a local CLI with no server, no database, and no HTTP
handlers. A pack finding nothing here says nothing about whether this codebase is safe.

### Severity bars

Runs use a **medium** bar, which admits the 3 WARNING findings and drops the 4 INFO ones.

The 4 below the bar were examined once, by hand, and are **noise**. All four are the same
construct: `detect-replaceall-sanitization` at `src/evidence/review-page.ts:160`, the
`escapeHtml` function. Semgrep matches the `.replaceAll()` chain once per nesting level, so
one five-line function produces four findings whose quoted expression grows by one call each
time. The function escapes `&` first and covers the five entities that matter for text and
attribute context; the rule is style advice about hand-rolled escaping, not a defect report.

Verified there is nothing behind it: every template interpolation in that file **not** wrapped
in `escapeHtml` is a number, a literal derived from a boolean, `isoTime(...)` off
`Date.toISOString()`, or the hardcoded `styles` constant. No model-controlled string reaches
the rendered HTML unescaped.

Decision: the bar stays at medium. This is recorded so it is not re-litigated.

### Dependency scanning

OSV-Scanner against `package-lock.json`: **zero advisories**.

That is narrow by construction: OSV matches known CVEs against a lockfile and says nothing
about unmaintained packages, install scripts, or transitive bloat. Those were examined
separately:

- 16 direct dependencies (9 runtime, 7 dev). **260 lockfile entries: 56 runtime, 204
  dev-only.** An earlier figure of 155 predates `@jazzer.js/core`, which alone pulls 84.
- Subtree attribution: `@jazzer.js/core` 84, `vitest` 42, `ink` 40, `typescript` 20, and
  everything else 8 or fewer. `zod`, `smol-toml` and `react` pull **zero** transitive
  dependencies. The shipped surface is small; the bulk is test tooling that never ships.
- **Exactly one** package runs an install script: `fsevents`, dev-only, pulled by vitest.
- Everything was published within about five weeks except `@jazzer.js/core` (2026-04-15).
- Single-maintainer packages: `smol-toml`, `zod`, `react`. Only `smol-toml` is both
  single-maintainer and parsing untrusted input, and that path is fuzzed.
- One real version gap: **`@types/node` is four majors behind** (22.20.1 against 26.2.0)
  while the runtime is Node 24. Unfixed.

None of this is wired into CROSSFIRE and it should not be: "outdated" and "dormant" are not
findings with repros, so they cannot pass the verify gate that makes a CROSSFIRE finding mean
anything. It belongs in a periodic report.

### Fuzzing

Eight Jazzer.js harnesses. Each loads from `.swarm/fuzz-build`, never from `../src`, because a
harness that imports TypeScript directly loads fine, runs **uninstrumented**, and produces
output identical to a clean codebase. `fuzz/smoke.mjs` replays every harness against its
seeds on every `npm run fuzz:build`, so a stale or broken harness fails the build instead of
reporting a clean run.

Coverage measured on a temp copy of the corpus, so the committed seeds are never mutated:

| harness | boundary | cov | ft | corpus | crashes |
|---|---|---|---|---|---|
| `adapter-output` | model output arriving at the tool chokepoint | 184 | 515 | 128 | 0 |
| `bundle-read` | `readBundle`, a bundle from another machine | 39 | 89 | 26 | 0 |
| `gate-parsers` | lcov and test-output parsing, the ratchet's measures | 155 | 445 | 167 | 0 |
| `ledger-chain` | what reaches the evidence ledger | 107 | 516 | 146 | 0 |
| `predicate` | `parsePredicate` / `evaluatePredicate` | 139 | 849 | 291 | 0 |
| `scrub` | `scrubText` / `scrubJson` / `findKnownSecrets` | 136 | 791 | 251 | 0 |
| `swarm-toml` | `parseSwarmToml` | 63 | 144 | 111 | 0 |
| `unified-diff` | `parseUnifiedDiff` / `reconstructSides` | 112 | 826 | 344 | 0 |

All eight at 300s each with accumulated corpora, all zero crashes. Every one is **proven
non-blind**: coverage in the tens to hundreds, not single digits.

`bundle-read` at 39 is the weakest and the reason is worth stating. Its first version mutated
manifest bytes directly, which put nearly every input on the far side of a schema parse that
failed immediately: 12 edges and a corpus that did not grow, a harness measuring `JSON.parse`
rather than the reader. Driving the field values from the input instead reaches 39. It stays
lowest because each execution writes and removes a directory, so the fuzzer gets far fewer of
them than the in-memory harnesses.

Three harnesses passed a two-sided negative control: a defect injected into the build fired
Jazzer's own detector, and fired the harness's independent assertion again with all bug
detectors disabled.

**The coverage curve does not support running these for hours.** Edge coverage was already
flat between consecutive 45s passes (predicate 139/139/139, ledger-chain 107/107, swarm-toml
63/63, adapter-output 183/181). Going to 600s per harness, about thirteen times the point
where the curve flattened, moved edge coverage by **one edge in total** across four harnesses
(ledger-chain 107 to 108), while the corpus grew from 15 seeds to 1,635 inputs on `predicate`
alone and feature tuples rose about 10 percent.

These are small, well-bounded parsers and their reachable edge set is exhausted inside a
minute. What a longer run buys is input *diversity* within already-covered code, which is a
real but much weaker argument than "coverage is still climbing". Note that both bugs fuzzing
has found here came from exactly that kind of diversity rather than from new coverage: the
`scrub` failures are specific byte patterns inside code the first seed already reached.

Corpora accumulate between runs under `.swarm/fuzz-corpus`, kept separate from the committed
seeds and from the temp workspace jazzer is pointed at.

## What was found and fixed

### Three ReDoS defects in the search tool

`src/tools/search-tool.ts` compiles a **model-supplied** pattern and runs it against every
line of the workspace, on the main thread, where a match in flight cannot be interrupted.

1. **Bare competing quantifiers** (`97c33ed5`, found by hand). `a+a+$` and friends. Closed by
   `src/tools/regex-safety.ts`, a structural reader that refuses ambiguous shapes before the
   pattern runs, plus an 8000-character cap on how much of a line any accepted pattern is run
   against.
2. **The grouped spelling** (`f3f63e79`, CROSSFIRE round 1; tests added by hand in
   `a627292c`). `(a+)(a+)$` was accepted while `a+a+$` was refused, because the neighbour scan
   read bare quantifiers only and a capture around one made it invisible.
3. **Escape-spelling bypass** (`7343ccf2`, CROSSFIRE, unaided, on code already hardened by 1
   and 2). Two distinct holes: a digit escape is a backreference only when the pattern has
   that many capture groups and is otherwise a legacy octal escape, so `\141+\141+\141+X` is
   `a+a+a+X` written another way; and an atom that no probe matched was read as *disjoint*
   rather than *undecided*, so `\1+\1+\1+X` over `\x01` was cleared. The probe alphabet was 95
   printable characters and is now all 256 code units, and an empty probe result now fails
   closed.

Verification evidence for (3), which is the one nobody had looked at:

- The bypass was exploitable, not merely accepted. `a+a+a+a+a+a+X` and its octal spelling
  `\141+...+X` have **identical** cost against a failing match: 1ms, 9ms, 51ms, 239ms at
  n = 20, 30, 40, 50. The guard refused the first and accepted the second.
- Graded against the pre-fix tree over 25 patterns in both directions: **2 bypasses closed, 0
  wrong answers**. All 15 accept-side patterns, including ordinary search patterns like
  `(\w+)@(\w+)\.com` and `function\s+(\w+)\(`, are still accepted.
- The dynamic repro CROSSFIRE verified against is a real `createSearchTool` call in a sandbox,
  timed, killed at 250ms, exiting 0 only if the search actually hung.

Fix (2) was graded the same way against the human fix that preceded it: **zero behavioural
differences** across 29 patterns.

**Test coverage is uneven and that is a real gap.** Fix (2) is pinned by tests
(`regex-safety.test.ts`, the grouped family). Fixes (1) and (3) shipped with **no regression
test**, because `**/*.test.ts` was in the config's `excludedPaths`, which the permission
policy reads, so the fixing agent was denied the file its own prompt told it to extend. The
tooling side of that is fixed; the missing tests for (1) and (3) are **not yet written**.

### Two secret-scrubbing defects, both found by the fuzz harness

`src/evidence/scrub.ts` is where a bug is least recoverable: the ledger is append-only, so a
credential that gets past it cannot be taken back out, and the blob directory it lands in is
what a bundle export copies to another machine.

1. **Values shorter than eight characters were never redacted.** `classifyValue` discarded
   them before the name could matter, so `hunter2` under a field named `password` travelled as
   plain text. The fix removes length from the redaction decision entirely and leaves it only
   in the blocking decision, which is the asymmetry the module already documents: scrubbing is
   fail-safe, blocking is not. A floor survives only where a value cannot carry a secret at
   all, and that floor is four, the number the numeric branch beside it already used for a PIN.
2. **The write-time scrub and the export scan disagreed about the same bytes**, which
   invariant 9 says cannot happen. They were two implementations of one predicate: one walked
   a payload that parsed and scanned everything else, the other only ever scanned. A regex and
   a parser cannot be made to agree by adding spellings to the regex, because `wordsOf` splits
   a name on any non-alphanumeric run, so `api/_key` is a credential to one and invisible to
   the other. Both now dispatch the same way, and the dispatch runs to a fixpoint, because
   scrubbing can change which arm the next reader takes.

Three further faults surfaced while closing the second, each a way scrubbing twice differed
from scrubbing once: the redaction marker spells "credential", so writing one into a key made
that key credential-bearing on the next pass; a child was read under the key that arrived
rather than the key that survives into the output; and overlapping spans leave what they cover
unexamined until a replacement shortens the text around them.

A separate live miss came out of the same work: the secret-scan **gate** returned nothing for
`+ {"b":{"client_secret":"..."}}` in a diff, because one match consumed the delimiter the next
name needed. The gate did not block.

Verification: `scrub` survives 600s of fuzzing with zero crashes where every earlier attempt
failed within three seconds, coverage 119 to 140. Five inputs are kept in `fuzz/findings` and
pinned by tests, and 8 of those tests fail against the previous source.

### Two ratchet-measurement defects

Found by the `gate-parsers` and `unified-diff` harnesses, one each, and they compose.
`parseUnifiedDiff` recorded an added line at line 0 for a deletion hunk, and `parseLineHits`
accepted `DA:0,1`. Each is inert alone, since nothing looks up line 0. Together they are a
line existing in no file counting as **covered**, because the coverage arm asks the report
about exactly the line numbers the diff gave it. Both now refuse a line number below one.

The diff reader also counted a file twice when a patch carried two headers for one path, and a
line twice when two hunks both declared they started at line 1, which inflates the coverage
denominator and the diff budget. And `stripPrefix` checked for emptiness before stripping the
`a/` prefix, so a bare `a/` came back as a changed file naming nothing.

## What was found and not fixed

One item. The two scrub defects that were open here are now closed; see below.

### `@types/node` behind the published major

Was 22.20.1 against 26.2.0 when this was written, on a Node 24 runtime. The 08-18 run moved
it to ^24.13.3, which matches the runtime floor; 26.2.0 is current upstream as of 2026-08-23,
so it is two majors behind the latest and level with what it is compiled against. Left there
deliberately: the types should track the Node the project supports, not the newest published.

## What CROSSFIRE structurally cannot find here

CROSSFIRE finds what a deterministic detector can flag and a repro can prove. That excludes
most of what would actually go wrong in this codebase.

- **Whether the ratchet's rules achieve what they claim.** `src/gates/ratchet.ts` and
  `measure-snapshot.ts` encode a long argument about which numeric movements constitute
  tampering. Whether that argument has a hole is a question about intent, not about a crash.
  A fuzzer cannot tell you that a monotonicity rule admits a patch nobody thought of.
- **Whether a verified claim proves what a reviewer thinks it proves.** Invariant 1's
  machinery binds a claim to a record and evaluates a predicate. The predicate parser is now
  fuzzed; the *semantics* are not checkable. A predicate that is true and irrelevant renders
  VERIFIED, and nothing here detects that.
- **The derivation heuristic's false-negative rate.** `src/tools/derivation.ts` is documented
  as a tunable heuristic with a false-positive rate. Its false *negatives* (a model-derived
  value that does not trip the confirmation path) are the security-relevant direction, and
  measuring them needs a labelled corpus nobody has built.
- **Whether the denied path set is the right set.** The sandbox mechanically denies `.env*`,
  `*.pem`, `*.key`, `.git/config`, `~/.aws`, `~/.ssh`. That the enforcement works is testable.
  That the list is complete for a given deployment is a design judgment.
- **Races in the worker merge queue.** `src/workers/` runs a git worktree per worker and lands
  them through a merge queue. Concurrency bugs there need a scheduler-aware test, not a
  fuzzer, and none exists.
- **Whether the hash chain is used correctly at every call site.** That `hashOfRecord` chains
  correctly is fuzzed. That every write path goes through it, and that nothing appends out of
  order under concurrency, is not.
- **Authorization between the orchestrator and its agents.** See below; this is the largest
  uncovered area and it is a design question throughout.

## Boundaries considered and deliberately not harnessed

Surveyed the whole tree for places external or model-controlled data enters. **All eight
ranked boundaries are now harnessed**: the ledger write path, the tool chokepoint,
`parseSwarmToml`, `parsePredicate`, `scrub`, `parsers.ts`, `unified-diff.ts`, and
`readBundle`.

Rejected, with reasons:

- **`src/tui/*`**: rendering, with one qualification added on 2026-08-23. A crash there is
  immediately visible and costs nothing, which is still the reason it carries no fuzz
  harness. What is not a crash is a tool output that carries terminal control: the action
  stream shows what tools returned, and an escape sequence in one is not a malformed input to
  a parser, it is a command the terminal obeys. Every string reaching a cell now goes through
  `src/tui/terminal-text.ts` first, which replaces each C0, DEL and C1 character with one
  visible cell, so the sequence is shown as text and the row keeps the width it was measured
  at. `src/tui/terminal-text.test.ts` and `src/tui/screen-model.test.ts` both assert it, the
  second by putting a screen-clearing sequence through a tool outcome and checking no escape
  reaches any row. That is a property test about one function rather than a boundary worth
  fuzzing, for the same reason `review-page.ts` is examined by hand: the assertion is about
  escaping, and it is exact.
- **`src/select/*`** (hardware probe, pricing, shortlist, calibration): a crash degrades
  model selection. No integrity or confidentiality consequence.
- **`src/tools/derivation.ts`**: documented as a heuristic with a false-positive rate, so a
  "wrong" answer is in spec. There is no assertion a harness could make.
- **`src/providers/message-conversion.ts`**: Zod-validated at the boundary per invariant 10.
  The schema is the check; fuzzing it tests Zod.
- **`src/evidence/review-page.ts`**: a crash costs nothing, and the real risk is HTML
  injection into a page a reviewer opens. That is a property test about escaping, not a fuzz
  target. Examined by hand instead; see the severity-bar section.

## What needs human review instead

Open items. None of these has been done, and none can be done by the tooling described above.

- **Threat-model the broker and adapter boundary.** The broker spawns agents over ACP, hands
  them prompts containing findings and diffs, and applies what they return. The trust
  questions are: what can a compromised or adversarial agent cause the broker to do; what does
  the permission policy actually constrain versus what does the prompt merely request; and
  what happens when an agent returns well-formed output that is deliberately wrong. This is
  where the interesting bugs in an agent orchestrator live and none of it is covered.
- **The trust model between orchestrator and agents.** Grok has read plus execute and never
  source write; Claude writes source. Whether that split holds under every tool the adapters
  expose, including any MCP server reachable from an agent's environment, is unverified.
- **Secret handling end to end.** Two defects above are in the scrub path. The broader
  question, whether a credential can reach a ledger, a bundle, a prompt, or a transcript by
  some route the scrubber never sees, has not been traced.
- **Authorization.** There is no user model here, but there is a privilege boundary: the
  sandbox. Whether every filesystem and shell path goes through it, and whether the chokepoint
  can be bypassed by any tool definition, deserves a read-through rather than a test.

## Known limitations of the tooling itself

- **Semgrep parses partially and silently.** This scan reported ~100% parsed, which is the
  only reason its null results carry any weight. A scan that parses 60% of a file reports
  findings from the 60% and says nothing about the rest. Always read the parse rate.
- **Scanner coverage is dominated by pack choice.** Sixteen packs found nothing and one found
  everything. The 7 findings are what `p/default`'s 213 rules happen to encode, not what is
  wrong with the code.
- **A harness proven non-blind at one boundary says nothing about any other.** Eight
  boundaries are instrumented. The other several dozen entry points in `src` are not, and the
  strongest statement available about them is that nobody has looked.
- **Fuzzing finds crashes and assertion failures, not wrongness.** Every property these
  harnesses check had to be written down by hand. The `scrub` finding surfaced only because
  the harness asserted that two sites agree; a harness that only checked "does not throw"
  would have run clean over the same input forever.
- **Zero crashes at these budgets is evidence, not proof.** All eight harnesses ran 300s
  each with accumulated corpora and found nothing, after the four defects the same harnesses
  found were fixed. On harnesses whose coverage is measured and
  non-blind that is meaningful evidence rather than an untested surface reporting clean. It is
  still bounded by budgets measured in minutes, and by the properties each harness asserts.
- **CROSSFIRE's convergence check is only as good as its scanners.** A run now re-scans
  after a fix and re-runs closed repros every round (see the appendix), so "clean" means a
  detect-and-verify pass over the patched source found nothing. That is a real check and it
  is still bounded by what `p/default` encodes and what the harnesses assert.

## Closed on 2026-08-18

Four things this document listed as open are now closed, and each is recorded with what
shows it rather than with an assertion that it is done.

### The ReDoS guard spellings now have tests

`src/tools/regex-safety.test.ts` went from 34 cases to 57. The three that shipped untested
are covered in both directions:

- **Octal escapes.** Every catastrophic shape retyped as `\141`, plus a two-digit and a
  one-digit octal, plus an octal atom compared against a literal one. The other direction
  matters as much and is pinned: `\141+\142+X` stays accepted, which is what says the
  reader decodes rather than refusing anything with a backslash in it, and `\18+\18+X`
  stays accepted, which binds the quantifier to the digit past the escape where the engine
  binds it.
- **Non-printable atoms.** A control character and a control-character class under two
  quantifiers, and `\1+\1+\1+X`, which is the case the disjointness comment names and
  which needs the octal decode and the sub-0x20 probes together to be visible at all.
- **The fail-closed empty probe.** An atom matching nothing, `[^\s\S]`, and one outside
  the probed range, refused in both the sequence and the nesting shape. The false positive
  this accepts is pinned too, an unprobed atom beside a disjoint probed one, because
  refusing a safe search is the direction this is allowed to be wrong in.

### All five preserved findings inputs are closed

`fuzz/findings/` held five artifacts, four of them undocumented and one written up as an
open scrub/export disagreement. All five replay clean against a fresh `fuzz:build`. The
transcript is in `evidence/2026-08-18/fuzz-findings-replay.md`.

| Input | What it found | Closed by |
| --- | --- | --- |
| `scrub-dispatch-flip` | scrubbing twice differed from once: a control byte made a payload unparseable, and removing it inside a redacted span made the result parse, so the next read took the other arm | `da7b9794` |
| `scrub-marker-in-key` | a redaction marker spells "credential", so writing one into a key made that key credential-bearing on the next pass | `da7b9794` |
| `scrub-name-separator` | `wordsOf` splits on any non-alphanumeric run, so `api/_key` was a credential to the parser and invisible to the regex | `da7b9794` |
| `scrub-overlapping-spans` | overlapping spans resolve by keeping the earliest, leaving what the later covered unexamined until the replacement shortened the text | `da7b9794` |
| `scrub-nested-multibyte-key` | `scrubText` redacted nothing while the export scan reported `credential-assignment` on that same output | `da7b9794` |

`da7b9794` closed all five and introduced the first four itself, as artifacts of faults it
found and fixed in the same change, which is why they were never written up.

The fifth is a disagreement, so an absence of crashes proves nothing about it and it was
checked by A/B across the closing commit instead. Building `da7b9794~1` in a detached
worktree: the parent redacts nothing and the export scan reports `credential-assignment`;
`v13-main` redacts `credential-field` and the scan reports nothing. The class is closed too,
checked against an astral character in the outer key, the same at three levels of nesting, a
BMP Cyrillic character in that position, and a single level.

None of the five is unguarded now. `src/evidence/scrub.test.ts` reads every `scrub-*.input`
in that directory and asserts the invariant 9 property against each, and its count assertion
fails if one goes missing.

### corpus-replay runs in CI, and did not before

This document said the suite had never run in CI and named `git archive origin/main` as the
fix. The diagnosis was right and the reason was not depth: `fetch-depth: 0` was already set.
From the checkout step of run 32150734348:

    [command] git -c protocol.version=2 fetch --prune --no-recurse-submodules origin \
      +refs/heads/*:refs/remotes/origin/* +refs/tags/*:refs/tags/*
     * [new branch]        main                      -> origin/main
    Switched to a new branch 'v13-main'

One local branch is created, the one being built. Everything else is a remote-tracking ref,
so `git archive main` resolves in any working clone and names nothing on CI.

The revision is now resolved against git rather than hardcoded, first of `main`,
`origin/main`, `refs/remotes/origin/main` that names a commit, with null kept as a real
answer for a fork that has no v12 branch. Before and after, from the CI logs:

| Run | Commit | corpus-replay |
| --- | --- | --- |
| 32150734348 | `ace2bda7` | 3 tests, **3 skipped** |
| 32151123787 | `84d2370a` | 7 tests, **0 skipped** |

Full transcript in `evidence/2026-08-18/corpus-replay-ci.md`.

### The scrub floor is stated where the guarantee is stated

Invariant 9 promised known-pattern scrubbing and said nothing about a length floor, so `pw`
under a `password` key passing through read as a defect against the stated guarantee rather
than as the guarantee. Both `CLAUDE.md` and `AGENTS.md` now state the four-character floor,
and `scripts/check-invariant-drift.mjs` fails CI if the two files stop agreeing. The floor
was not lowered: four is where a value cannot carry a credential at all, and it is the
number the numeric branch already used for a PIN.

## Not yet in place

- **The weekly scan is scheduled but has never fired.** `.github/workflows/weekly-scan.yml`
  runs Semgrep `p/default` at WARNING and above, OSV-Scanner, and the fuzz smoke every
  Monday, opens an issue on findings, and fails loudly if it cannot open one. It was added
  on 2026-08-18 and no scheduled run has happened yet, so nothing in this document has been
  re-verified by it. The mechanism exists; the evidence that it works on a schedule does not.
- **Semgrep and OSV-Scanner in that workflow are unexercised.** Both steps were written and
  neither has run, in CI or locally, in the pass that added them. The push workflow runs
  gates, the invariant-drift check and `fuzz:build`, and those three are confirmed green
  remotely.
- **The four judge-shaped residuals are open**, and closing them is not planned for this
  release. They are in build guide 7.1 and each is a permanent case in
  `src/evidence/redteam-adversarial.test.ts` asserting the gap as it stands.

## Appendix: cross-round finding memory

**Built.** Recorded here because it is the prerequisite for a scheduled run, and because the
termination gap it closed is one of its two symptoms. What follows is what it does and what
it still cannot promise.

**Symptom 1, termination.** The loop ended when every confirmed finding was closed, with the
open set refreshed only by the fuzz cross-check. The scanners were not re-run, so "clean"
meant "what we knew about is closed", not "a detect pass over the patched source found
nothing", and a residual in a different shape than the repro tests went unseen. A round now
re-runs the scanners after a fix. Scanners only: the fuzzers already have a post-fix pass, and
repeating them would put a full fuzz budget into every converging round.

**Symptom 2, cost.** A full re-scan is the obvious fix and is currently unaffordable, because
some constructs match forever. `detect-non-literal-regexp` still matches `search-tool.ts`
today and always will, since constructing a RegExp from model input is what the tool is for.
Re-scanning every round re-raises it and re-pays a confirmation turn (measured at 419s and
768s) every round. The two standing dismissals were likewise re-derived across runs at 106s
then 91s, and 31s then 23s.

**Mechanism.** Verdicts are memoized by finding id and written into each round's ledger entry,
so they chain like every other record and a resumed or scheduled run inherits them. The id
already does the work: it hashes rule, file, and the whitespace-normalized
flagged construct, with no line number, so id equality means the construct is unchanged and no
stale verdict can transfer across an edit. Add one chained ledger record carrying the finding
id, the verdict, and the repro for a closed one. Then each raised candidate either has no
prior verdict (spend a confirmation turn), carries a `dismissed` verdict (carry it forward,
free), or carries a `closed` verdict, in which case **re-run its repro mechanically** rather
than re-confirming it with an agent. A repro that exits 0 again means the fix regressed, and
the finding reopens as already-confirmed, straight to a fix turn.

Termination then means what golden rule 3 says, and the steady-state round costs zero agent
turns.

**Limitation, stated rather than designed away.** A carried dismissal is only as good as its
reasoning, and both standing dismissals here are *reachability* arguments ("`name` is never
attacker-controlled; every call site passes a hardcoded literal"). The id pins the flagged
construct, so editing it invalidates the verdict. It does not pin the call sites: adding one
caller that passes model output to `counterPattern` makes that dismissal wrong while its id is
unchanged. Dismissals must therefore expire and be re-derived. A closed finding does not need
to, because its repro is re-run every round regardless. That asymmetry is the honest one: a
mechanical check can be trusted indefinitely, an argument cannot.
