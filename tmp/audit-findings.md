# Provider Architecture Follow-Up — Pre-Flight Audit

## A1. Test count reconciliation

### Suite numbers

| State | passing | pending | failing | skipped |
|---|---|---|---|---|
| Pre-first-pass (HEAD `637f6f4` with stash) | 2290 | 12 | 0 | 0 |
| Post-first-pass (working tree as received) | 2372 | 12 | 0 | 0 |
| Delta | +82 | 0 | 0 | 0 |

The pre-first-pass baseline was obtained by `git stash -u` of every working-tree
modification and new file, running `npm test`, recording the count, then
`git stash pop`. The post-first-pass number is the canonical working tree.

### New-file `it()` inventory

| File | static `it(` declarations | runtime cases | run? |
|---|---|---|---|
| `test/contract/extractor-deterministic.test.ts` | 10 | 24 | yes |
| `test/contract/extractor-factory.test.ts` | 9 | 9 | yes |
| `test/contract/extractor-local.test.ts` | 5 | 5 | yes |
| `test/inference/local-backends.test.ts` | 9 | 9 | yes |
| `test/session/deterministic-session.test.ts` | 18 | 18 | yes |
| `test/session/factory.test.ts` | 9 | 9 | yes |
| `test/session/local-session.test.ts` | 7 | 7 | yes |
| `test/e2e/deterministic-full-cycle.test.ts` | 1 | 1 | yes |
| **Total** | **68** | **82** | — |

`extractor-deterministic.test.ts` has two `for (const fixture of …)` loops
that emit one `it()` per iteration (8 + 8 = 16 cases) plus 8 unparameterized
cases — 24 total. All other files have a 1:1 declaration-to-case ratio.

### Reconciliation

82 new cases declared = 82 net passing-count delta. The math closes.

The first-pass status report claimed "2350 → 2372 (+22)." That number was
incorrect: the real pre-refactor baseline is 2290, not 2350. The status
report under-counted the baseline by 60. Nothing is hidden, nothing is
skipped, every new test is running.

### Hidden tests

None. No `describe.skip` / `it.skip` / `xdescribe` / `xit` in any new file.
No environment-gated suites (the env-var manipulation in the factory and e2e
tests is for clearing state inside the test, not for gating).

## A2. Heuristic stub-session investigation

### What the stub does

`src/session/stub-session.ts` is a deterministic in-memory `Session`
implementation that runs the responder callback (default: an echo of the
persona id and message length) and reports synthetic-but-consistent token
usage based on the 4-chars-per-token heuristic. It also implements
`stream()` with simulated chunking and `providerInfo()` returning
`{ provider: 'stub', usageEstimated: true, ... }`.

It is NOT a patch-replaying provider. The deterministic session
(`src/session/deterministic-session.ts`) reads patches from a directory,
queue file, stdin, or pre-loaded array. The stub generates synthetic text
on demand. They are distinct paths, not subset/superset.

### Reachability

Two ways the stub class can be constructed:

1. **CLI factory path:** `--session stub` (and `--extractor stub` /
   `--extractor stub-heuristic` for the contract extractor). `factory.ts`
   accepts `'stub'` as a valid value. The default for both factories is
   `'deterministic'`; the stub is only reached on explicit opt-in.

2. **Direct construction in tests:** seven test files import
   `StubSession` from `src/session/stub-session` and call `new StubSession({...})`
   directly. The same pattern for `StubExtractor`.

3. **Indirect production import:** `src/verification/live-cost-tracker.ts`
   imports `estimateTokens` from `stub-session.ts`. That function is the
   shared 4-chars-per-token estimator; it is not a stub-construction site.

No default or fallback path reaches the stub. The factory's `default`
branch is `deterministic`. A misconfigured anthropic provider throws,
does not fall through.

### Decision: Hide

The stub is documented as a back-compat alias in factory JSDoc, but the
first-pass spec ("the three documented providers are the only paths a
user can reach") cannot be honored as long as `'stub'` / `'stub-heuristic'`
remain in the factory's accepted provider unions and in `--help` output.

The chosen outcome is **Hide**:

- Remove `'stub'` and `'stub-heuristic'` from `ExtractorProvider`,
  `EXTRACTOR_PROVIDERS`, the `buildExtractor` factory branch, and any
  `--help` enumeration.
- Remove `'stub'` from `SessionProvider`, `SESSION_PROVIDERS`, the
  `buildSession` factory branch, and any `--help` enumeration.
- Keep `StubSession` and `StubExtractor` exported from
  `src/session/index.ts` and `src/contract/index.ts` so tests and the
  synthetic-mode benchmark can still construct them directly. Mark the
  module-level JSDoc with `@internal` and a note that the class is not
  reachable from any CLI surface.
- Update the two factory tests that assert the stub path returns the
  expected type. The classes are still constructible; only the CLI route
  is removed.
- Move `estimateTokens` to a non-stub home so production code
  (`live-cost-tracker.ts`) does not import from a file marked
  `@internal`. Destination: `src/session/token-estimator.ts`. Tests and
  the stub session import from there.

This is "Hide" in the prompt's terms: removes the production CLI exposure
while preserving the class for test / benchmark use without physically
relocating it (the codebase's test files import directly from
`src/session/stub-session`, and reshuffling test imports is more churn
than the constraint requires).

## A3. DoD 2 / 7 / 13 confirmations

### DoD 2 — No silent fallback between providers

Factory inspection (`src/contract/extractor/factory.ts`,
`src/session/factory.ts`, `src/inference/local/factory.ts`):

- Anthropic without API key: **throws** with `'anthropic … selected but
  ANTHROPIC_API_KEY is not set; pass --api-key …'`. No fallback.
- Deterministic extractor without contract input: **throws**. No fallback.
- Deterministic session without patch source: **throws**. No fallback.
- Local provider without `LOCAL_LLM_BASE_URL`: `resolveLocalBaseUrl`
  **throws**. No fallback.
- Local extractor without model id: **throws**. No fallback.
- Local session without model id: **throws**. No fallback.
- Local backend without recognized name: **throws** listing valid values.
- Unknown `--extractor` / `--session` value: `resolveExtractorProvider`
  and `resolveSessionProvider` **throw** listing valid values.

Existing test coverage:

- `test/contract/extractor-factory.test.ts:51` "fails loud when
  deterministic is selected without any contract input"
- `test/contract/extractor-factory.test.ts:63` "fails loud when anthropic
  is selected without an API key"
- `test/contract/extractor-factory.test.ts:33` "rejects an unknown
  provider with a corrective message"
- `test/session/factory.test.ts:45` "fails loud when deterministic is
  selected without any patch source"
- `test/session/factory.test.ts:57` "fails loud when anthropic is selected
  without an API key"
- `test/session/factory.test.ts:30` "rejects an unknown provider"

Missing coverage (added in this pass):

- Local provider missing `LOCAL_LLM_BASE_URL` / `--local-base-url`.
- Local provider missing `LOCAL_LLM_MODEL_*` / `--local-model-*`.
- Local provider with unknown backend name.

### DoD 7 — End-to-end test with zero external deps

`test/e2e/deterministic-full-cycle.test.ts` exists and passes. It
explicitly `delete`s `ANTHROPIC_API_KEY`, `EXTRACTOR_PROVIDER`, and
`SESSION_PROVIDER` in `beforeEach`. It does NOT delete `LOCAL_LLM_*`
env vars, but the test path selects `--extractor deterministic` and
`--session deterministic`, so `LOCAL_LLM_*` is unreachable on that
codepath. The test asserts post-run that `process.env.ANTHROPIC_API_KEY`
remained unset throughout, catching any accidental leak from the
pipeline. **Result: passing on the current working tree.**

Hardening item: extend `beforeEach` to also clear `LOCAL_LLM_*` env
vars for belt-and-braces. Done as part of W1 work.

### DoD 13 — Repository grep for misleading references

`README.md`:

- L18: "zero API keys" in context. **OK**.
- L20: "the `anthropic` provider does the same against Claude". **OK** — describes the provider, not the default.
- L37: `ClaudeCode opt-in (see …)` — falsifier doc. **OK**.
- L42: "No model, no API key, no network access required". **OK**.
- L56: "deterministic by default — no model call, no API key needed". **OK**.
- L114: "Anthropic (opt-in; requires `ANTHROPIC_API_KEY`)". **OK**.
- L121–122: anthropic flag examples. **OK** in opt-in section.
- L174: "the Anthropic extractor uses a Sonnet …" — describing the
  anthropic provider. **OK**.
- L181: "the Anthropic session uses a cached prompt-cache-native …". **OK**.
- L222: ClaudeCodeFalsifier row. **OK**.
- L226: falsifier registry config. **OK**.
- L234: "`--extractor deterministic|local|anthropic|stub`" — exposes the
  stub option. **Must fix**: stub will be removed in W5.
- L237: "`--session deterministic|local|anthropic|stub`" — same. **Must fix**.
- **L263: "The action uses the Anthropic provider by default for goal
  compilation"** — `entrypoint.sh` and `action.yml` do NOT set a
  provider; the CLI defaults are `deterministic`. This line is stale and
  misleading. **Must fix**.
- **L274: "Required when using the Anthropic provider (the default for the
  action …)"** — same root cause. **Must fix**.
- L285: env-file purpose row. **OK**.
- L293: link to `CLAUDE.md`. **OK**.

`docs/configuration.md`:

- L11–12: lists `stub` and `stub-heuristic` as accepted CLI values. **Must
  fix**: drop these after W5.
- L57, L61, L113–118: anthropic-provider section, correctly framed as
  opt-in. **OK**.
- L116–118: anthropic flag examples. **OK**.
- L132: link to CLAUDE.md. **OK**.

`docs/providers.md`:

- L8, L12: provider matrix correctly notes "required when using anthropic". **OK**.
- L28, L163–186: anthropic section, opt-in framing. **OK**.

`docs/migration.md`:

- All anthropic mentions describe the migration FROM anthropic-as-default
  TO deterministic-as-default. **OK** but **add a first-pass-corrections
  subsection** per the prompt for any audit-surfaced issues (the
  README:263 / 274 staleness and the stub-CLI removal).

`CHANGELOG.md`:

- L11: "Default provider changed from `anthropic` to `deterministic`." **OK**.
- L13: example of switching back. **OK**.
- L20: "no network access, no model, no API key". **OK**.
- L36: e2e test claim. **OK**.
- L46, L49–50: anthropic provider changes. **OK**.
- L163–167, L209: historical entries about Claude Code falsifier and the
  pre-refactor v8 line. **OK**.

### Must-fix list

1. `README.md:234` — drop `stub` from documented `--extractor` list.
2. `README.md:237` — drop `stub` from documented `--session` list.
3. `README.md:263–276` — rewrite the GitHub Action section to reflect
   `deterministic` as the action's default (matching the CLI default,
   since `entrypoint.sh` does not set a provider).
4. `docs/configuration.md:11–12` — drop `stub` / `stub-heuristic` from
   the accepted values column.

## A4. Ledger consumer scan

Every consumer of `LedgerEntry`:

| Consumer | Reads provider mixin fields? |
|---|---|
| `src/ledger/ledger.ts` (writer + reader) | no |
| `src/ledger/memoization.ts` | no |
| `src/ledger/resume.ts` | no |
| `src/cli/v8/stats-handler.ts` | no |
| `src/population/manager.ts` (writer of attribution) | writes only |
| `src/ledger/index.ts` (re-exports) | no |

No external code reads `provider`, `model`, `backend`, `grammar`, `seed`,
`source`, or `usageEstimated`. The `ProviderAttribution` mixin is
strictly additive on three entry types
(`CandidateRecordedEntry`, `CandidateDiscardedEntry`,
`CandidateStreamAbortedEntry`); all fields are optional, so older
ledgers parse without modification. **No consumer breaks. No fix needed.**

## Decisions recorded in this audit

1. Test-count math closes: 82 new declarations = 82 new passes. The
   first-pass status report's baseline (2350) was wrong; the real
   baseline is 2290. No hidden tests, no skipped tests, no env-gated
   tests.
2. Stub session resolution: **Hide** (drop from CLI provider unions,
   extract `estimateTokens` to a non-stub home, keep classes for
   test/benchmark use, mark module `@internal`).
3. DoD 2 holds for the seven misconfiguration paths, with three new
   tests to add (local missing baseUrl, local missing model, local
   unknown backend).
4. DoD 7 holds; e2e test passes with no `ANTHROPIC_API_KEY` and no
   `LOCAL_LLM_*` env vars in the deterministic path.
5. DoD 13 has four must-fix doc references (two README list lines, two
   README GitHub-Action paragraphs, one configuration.md row). These are
   fixed in the docs commit.
6. No ledger consumer breaks under the `ProviderAttribution` mixin.
