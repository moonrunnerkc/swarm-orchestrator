# Security coverage

What has actually been examined in this repository, what was found, and what is deliberately
not covered. Written to be audited rather than believed: every claim below names the tool,
the version, the scope, and the evidence, and anything not verified says so.

Scope of this document: the v13 lineage (`v13-main` and its descendants). The `main` branch
is a separate, unrelated history (swarm-orchestrator@12.1.1, a PR auditor) and nothing here
applies to it.

Last updated after the hardening pass described below. Findings are as of that pass; nothing
here is continuously re-verified, because no scheduled run exists yet (see
[Not yet in place](#not-yet-in-place)).

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

Five Jazzer.js harnesses. Each loads from `.swarm/fuzz-build`, never from `../src`, because a
harness that imports TypeScript directly loads fine, runs **uninstrumented**, and produces
output identical to a clean codebase. `fuzz/smoke.mjs` replays every harness against its
seeds on every `npm run fuzz:build`, so a stale or broken harness fails the build instead of
reporting a clean run.

Coverage measured on a temp copy of the corpus, so the committed seeds are never mutated:

| harness | boundary | budget | cov | ft | corpus | crashes |
|---|---|---|---|---|---|---|
| `adapter-output` | model output arriving at the tool chokepoint | 600s | 181 | 554 | 778 | 0 |
| `ledger-chain` | what reaches the evidence ledger | 600s | 108 | 549 | 874 | 0 |
| `swarm-toml` | `parseSwarmToml` | 600s | 63 | 146 | 182 | 0 |
| `predicate` | `parsePredicate` / `evaluatePredicate` | 600s | 139 | 872 | 1635 | 0 |
| `scrub` | `scrubText` / `scrubJson` / `findKnownSecrets` | 45s | 119 | 285 | 21 | **1** |

`scrub` is at a shorter budget because it fails on the finding recorded below, within about
30 seconds. It cannot do a long run until that is fixed, and a longer budget would only
re-find the same input.

All five are **proven non-blind**: coverage in the tens to hundreds, not single digits. The
`scrub` harness additionally passed a two-sided negative control: prototype pollution injected
into the build fired Jazzer's own detector, and fired the harness's independent assertion
again with all bug detectors disabled.

Budgets actually run: 300s per harness inside CROSSFIRE rounds, repeated 45s passes during
validation, and a 600s-per-harness pass with an accumulating corpus. **No harness has been
run for hours, and the coverage curve says that would be waste rather than caution.**

Edge coverage was already flat between consecutive 45s passes (predicate 139/139/139,
ledger-chain 107/107, swarm-toml 63/63, adapter-output 183/181). Going to 600s per harness,
about thirteen times the point where the curve flattened, moved edge coverage by **one edge
in total** across all four (ledger-chain 107 to 108). Over the same period the corpus grew
from 15 seeds to 1,635 inputs on `predicate` alone and feature tuples rose about 10 percent.

These are small, well-bounded parsers and their reachable edge set is exhausted inside a
minute. What a longer run buys is input *diversity* within already-covered code, which is a
real but much weaker argument than "coverage is still climbing". Note that the one bug
fuzzing has found here came from exactly that kind of diversity, not from new coverage: the
`scrub` failure is a specific byte pattern inside code the first seed already reached.

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

## What was found and not fixed

These are open. None has a scheduled re-check.

### `scrub.ts` drops credentials shorter than eight characters

`classifyValue` returns `not-credential` for any value under 8 characters, so a value under a
credential-bearing name is never redacted below that length. Measured boundary, identical on
both the text and structural paths:

| value | length | result |
|---|---|---|
| `"pw"` | 2 | leaks |
| `"s3cr3t"` | 6 | leaks |
| `"hunter2"` | 7 | leaks |
| `"hunter22"` | 8 | redacted |

`isCredentialName("password")` returns true, so the name is recognised and the value is
discarded on length before the name can matter. This contradicts invariant 9 ("keys on the
assignment name or the field name rather than on the shape of the value") and the comment
above `classifyValue` ("the credential is scrubbed out of every record either way").

Cost: a short credential under a field named `password` enters an **append-only** ledger, and
the blob directory it lands in is what a bundle export copies to another machine.

Unfixed because the obvious change, dropping the floor in the `named` context, is a
false-positive tradeoff over what lands in every record, and the numeric branch beside it
shows the author already reasoned about that tension.

### `scrubText` and `findKnownSecrets` disagree on nested payloads with wide characters

Found by the `scrub` harness within 30 seconds of fuzzing, on clean code. Input preserved at
`fuzz/findings/scrub-nested-multibyte-key.input`.

    {"a<U+FFFD>":{"b":{"client_secret":"0123456789abcdefghij"}}}

`scrubText` redacts **nothing**, and `findKnownSecrets` run on that same unchanged output
reports `credential-assignment`. The write-time scrub misses a credential the export scan
catches, which is precisely what invariant 9 says cannot happen: "one detector serves the
write-time scrub, the export-time scan, and the secret-scan gate, so the three cannot drift
apart."

Trigger characterised: a character outside the BMP (U+FFFD, an emoji) in an **outer** key,
with the credential nested two levels below it. A BMP character in that position does not
trigger it, one level of nesting does not, and the same character inside the value does not.
`scrubJson` handles the payload correctly, so only the text path is wrong. An emoji in a key
is ordinary model output, so this is reachable rather than theoretical.

### `@types/node` four majors behind

22.20.1 against 26.2.0, on a Node 24 runtime.

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

Surveyed the whole tree for places external or model-controlled data enters. Harnessed: the
ledger write path, the tool chokepoint, `parseSwarmToml`, `parsePredicate`, and `scrub`.
Ranked next but **not built**: `parsers.ts` (`parseLineHits` and the TAP parsers, the
ratchet's measurement layer), `unified-diff.ts` (`parseUnifiedDiff`), and `bundle.ts`
(`readBundle`, the only genuinely third-party input in the system). Those three are worth
building and are simply not done.

Rejected, with reasons:

- **`src/tui/*`**: rendering. A crash is immediately visible and costs nothing.
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
- **A harness proven non-blind at one boundary says nothing about any other.** Five boundaries
  are instrumented. The other several dozen entry points in `src` are not, and the strongest
  statement available about them is that nobody has looked.
- **Fuzzing finds crashes and assertion failures, not wrongness.** Every property these
  harnesses check had to be written down by hand. The `scrub` finding surfaced only because
  the harness asserted that two sites agree; a harness that only checked "does not throw"
  would have run clean over the same input forever.
- **Zero crashes at these budgets is evidence, not proof.** Four harnesses ran 600s each with
  accumulated corpora and found nothing. On harnesses whose coverage is measured and
  non-blind that is meaningful evidence rather than an untested surface reporting clean. It is
  still bounded by budgets measured in minutes, and by the properties each harness asserts.
- **CROSSFIRE does not re-scan before declaring convergence.** See below. A run that ends
  "clean" has verified that the findings it already knew about are closed, which is weaker
  than a fresh detect pass finding nothing.

## Not yet in place

- **No scheduled run.** Everything here was produced by runs launched by hand. Nothing
  re-verifies on a schedule, so this document decays from the day it was written.
- **No regression tests for ReDoS fixes (1) and (3).**
- **Three ranked fuzz boundaries unbuilt**: `parsers.ts`, `unified-diff.ts`, `readBundle`.
- **The corpus-replay suite has never run in CI.** `src/gates/corpus-replay.test.ts` resolves
  the v12 falsification corpus via `git archive main`, which works locally because a local
  `main` branch exists and fails in CI where only `origin/main` does. It skips visibly by
  design, so nothing is silently green, but **1,043 corpus cases calibrating the ratchet have
  never been replayed by CI.** `git archive origin/main` works.

## Appendix: cross-round finding memory

Recorded here because it is the prerequisite for a scheduled run, and because the termination
gap above is one of its two symptoms.

**Symptom 1, termination.** The loop ends when every confirmed finding is closed, where the
open set is refreshed only by the fuzz cross-check. Semgrep and OSV are not re-run, so "clean"
means "what we knew about is closed", not "a fresh detect pass found nothing". A residual in a
different shape than the repro tests goes unseen.

**Symptom 2, cost.** A full re-scan is the obvious fix and is currently unaffordable, because
some constructs match forever. `detect-non-literal-regexp` still matches `search-tool.ts`
today and always will, since constructing a RegExp from model input is what the tool is for.
Re-scanning every round re-raises it and re-pays a confirmation turn (measured at 419s and
768s) every round. The two standing dismissals were likewise re-derived across runs at 106s
then 91s, and 31s then 23s.

**Mechanism.** Memoize verdicts by finding id, and re-run the full detector suite before
terminating. The id already does the work: it hashes rule, file, and the whitespace-normalized
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
