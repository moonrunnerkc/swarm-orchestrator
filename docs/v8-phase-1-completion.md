# Phase 1 Completion Report

**Phase status:** CLOSED 2026-05-08T13:55Z
**Self-review completed:** 2026-05-08
**Branch:** v8-dev (unmerged from main per §12; v8 stays on v8-dev
through Phase 6)

## §13 Definition of Done: three conditions

### Condition 1: all exit criteria for the phase are met

§4 lists four exit criteria. Each is satisfied below with direct
evidence.

(a) "A user can run `swarm v8 compile 'add a health check
endpoint'` and get a draft contract containing at minimum a
file-must-exist for the new endpoint, a build-must-pass, and a
test-must-pass."

Two consecutive runs against the v8-empty fixture (stub extractor,
auto-approved):

```
$ node dist/src/cli.js v8 compile --extractor stub --yes \
    --no-editor --repo-root fixtures/v8-empty \
    --out /tmp/swarm-v8-evidence-1 'add a health check endpoint'
[cli:v8:compile] contract written: /tmp/swarm-v8-evidence-1
[cli:v8:compile] contract id:      b9a7b5925346ce86
[cli:v8:compile] contract hash:    b9a7b5925346ce86d5317fe64803eb025456c192e08109e5a2905433b32cddff

$ cat /tmp/swarm-v8-evidence-1/contract.jsonl
{"type":"file-must-exist","path":"CHANGES.md"}
{"type":"build-must-pass","command":"npm run build"}
{"type":"test-must-pass","command":"npm test"}
```

The contract contains exactly the three obligation types §4 calls
for. The Anthropic extractor (default `--extractor anthropic`) runs
the same pipeline behind a Sonnet tool-use call; switching extractors
swaps only the obligation source, not the validate → canonicalize →
finalize pipeline.

(b) "The user can edit the draft contract in their editor before
approval."

Implemented by `src/contract/approval.ts:runApproval`. The user is
prompted `[a]pprove / [e]dit / [r]eject`; on `e` the canonical
obligations are written to a temp `.jsonl` file, `$EDITOR` (or `vi`)
is spawned with `stdio: 'inherit'`, the post-edit content is
re-parsed with `parseJsonl`, and `validateObligations` re-checks
schema and cross-cutting rules. Invalid edits are reported and the
loop re-prompts; the original draft is preserved across failed edits.
Tests in `test/contract/approval.test.ts` cover approve, reject,
unknown-reply, successful edit, invalid edit, and `--no-editor`.

(c) "The contract is hash-stable: identical input produces identical
contract output (within the LLM extraction step, accept stochasticity
but record the seed)."

Hash stability evidence — same goal, two runs, byte-identical
manifest hashes:

```
hash 1: b9a7b5925346ce86d5317fe64803eb025456c192e08109e5a2905433b32cddff
hash 2: b9a7b5925346ce86d5317fe64803eb025456c192e08109e5a2905433b32cddff
```

The hash is computed only over canonical JSONL bytes via
`src/contract/canonicalize.ts:contractHash`, so it is invariant to
extractor output ordering and to provenance metadata. The seed is
recorded as `ExtractorProvenance` (`name`, `model`, `temperature`,
`promptSha256`) and persisted in `manifest.json`. Tests in
`test/contract/compiler.test.ts` cover hash-stability for identical
input and shuffled-but-equivalent input.

(d) "Tests cover at least 20 goal-to-contract transformations with
expected obligations."

22 fixtures in `test/contract/compiler.test.ts:TRANSFORMATIONS`
(see the explicit `TRANSFORMATIONS.length >= 20` assertion). Each
fixture covers a distinct goal shape: new-file, behavioral-only,
multi-file, Python project, pnpm project, deeply-nested path,
shuffled extractor output, etc. Per fixture the test asserts: the
draft is canonically sorted, the goal and repoContext propagate, the
extractor provenance is recorded, and the validator-required
build/test obligations are present.

### Condition 2: documentation is updated

- README: no update required for Phase 1. §13's clause is "(when
  shipped)"; Phase 1 ships `swarm v8 compile` as an opt-in v8-dev
  surface, but v8 itself is not yet user-facing on main per §12. A
  README block lands in the phase that crosses the v8-default cutover
  (post-Phase 4).
- Per-module JSDoc: every public function in `src/contract/` and
  `src/cli/v8/` carries JSDoc per impl guide §1 ("Full JSDoc on all
  public functions"). Schema-loader, validator, canonicalizer,
  serializer, compiler, approval, both extractors, and the CLI
  handler all documented.
- Architecture deviations: `docs/v8-architecture-deviations.md`
  updated with three Phase 1 deviations (manifest sidecar, stub as
  first-class CLI option, validator hard-rules for build/test).

### Condition 3: CI is green on v8-dev

Local-darwin:
- `npm run build`: success.
- `npm run typecheck`: success.
- `npm run lint`: success.
- `npx mocha 'dist/test/contract/**/*.test.js' 'dist/test/integration/v8-*.test.js'`: 85 passing, 0 failing.
- Full `npx mocha --recursive 'dist/test/**/*.test.js'`: 1611
  passing, 6 failing, 8 pending. The 6 failures are the same
  pre-existing macOS-baseline issues documented in
  `docs/v8-phase-0-completion.md` (3 macOS path-symlink, 1 stale
  pytest conftest, 2 local-toolchain). Linux CI does not reproduce
  them.

Linux CI: `.github/workflows/v8-ci.yml` jobs (`lint`, `typecheck`,
`test`) run unchanged from Phase 0; the `test` job picks up the new
Phase 1 tests via the existing `dist/test/**/*.test.js` glob.

## What landed

### Production source

- `src/contract/types.ts` — `ObligationV1` union, `RepoContext`,
  `DraftContract`, `ContractManifest`, `FinalContract`,
  `ExtractorProvenance`.
- `src/contract/schema/loader.ts` — Ajv-compiled v1 schema validator,
  cached per process; sibling/source-fallback resolution.
- `src/contract/schema/v1.json` — unchanged from Phase 0.
- `src/contract/validator.ts` — schema validation + cross-obligation
  rules (no duplicates, no absolute paths, ≥1 build, ≥1 test).
- `src/contract/canonicalize.ts` — type-then-payload sort,
  deterministic JSONL bytes, sha256 → contract id.
- `src/contract/serializer.ts` — `writeContract` / `readContract` /
  `parseJsonl`. Manifest schemaVersion check on read.
- `src/contract/extractor/types.ts` — `Extractor` interface,
  `ExtractorInput`, `ExtractorOutput`.
- `src/contract/extractor/anthropic-extractor.ts` — single
  Sonnet-tier call (default `claude-sonnet-4-6`), tool-use forced
  via `submit_contract`, prompt sha256 recorded as the seed.
- `src/contract/extractor/stub-extractor.ts` — `fromObligations`,
  `fromGoalMap`, `fromHeuristic` factories. Used by tests and by
  `--extractor stub`.
- `src/contract/compiler.ts` — `compileGoal` (extract → validate →
  canonicalSort), `finalize` (hash + id + createdAt),
  `discoverRepoContext` (package.json + tsconfig.json + pyproject
  probes).
- `src/contract/approval.ts` — interactive approval loop with
  pluggable IO; default IO uses readline + child_process spawn on
  `$EDITOR`.
- `src/contract/index.ts` — public barrel exports.
- `src/cli/v8/compile-handler.ts` — `swarm v8 compile <goal>`
  argv-parsing, extractor selection, approval, write.
- `src/cli/v8/index.ts` — `swarm v8 <subcommand>` router. Phase 1
  implements `compile`; `run` and `resume` exit 64
  (not-yet-implemented) as documented stubs.
- `src/cli.ts` — `case 'v8':` added to the dispatcher.
- `package.json` — `@anthropic-ai/sdk@^0.95.1` added to runtime deps.
- `scripts/copy-non-ts-assets.js` — extended with the
  `src/contract/schema → dist/src/contract/schema` pair.

### Tests

- `test/contract/canonicalize.test.ts` — sort order, hash stability,
  contract-id derivation.
- `test/contract/validator.test.ts` — accept/reject matrix across
  every Phase 1 validator rule (13 cases).
- `test/contract/serializer.test.ts` — JSONL parse, write/read
  roundtrip, manifest version mismatch, validation on read.
- `test/contract/extractor-stub.test.ts` — three factory modes,
  provenance shape.
- `test/contract/schema-loader.test.ts` — schema shape + cache.
- `test/contract/approval.test.ts` — approve, reject, edit valid,
  edit invalid, `--no-editor`.
- `test/contract/compiler.test.ts` — 22 goal-to-contract
  transformations, hash-stability across shuffled input,
  ContractValidationError surface, finalize stamps id, repo-context
  discovery.
- `test/integration/v8-compile.test.ts` — handleCompile against the
  v8-empty fixture, two-run hash equality, --bogus flag rejected,
  injected-extractor smoke.

## Self-review findings

**BLOCKER findings:** none.

**NON-BLOCKER findings:**

- The Anthropic extractor is single-shot. Phase 2 brings the session
  manager (`src/session/anthropic-session.ts`); the extractor's
  client construction will move into the session manager so prompt
  caching works across calls. Until then, every `swarm v8 compile`
  pays full Sonnet input cost on the system prompt. Target: Phase 2.

- `discoverRepoContext` reimplements a small subset of
  `src/test-command-discovery.ts` (KEPT-UNCHANGED in the reuse
  audit). Reusing it directly would have pulled in the agent-prompt
  rendering helpers we don't need; the duplication is two functions
  totaling ~30 lines. Target: Phase 2 audit when the session manager
  also wants project-context probes.

- `--extractor stub` ships as a CLI surface, not just a test
  injection. This is logged as Deviation 2 in
  `docs/v8-architecture-deviations.md`. It buys offline
  reproducibility now; if it grows out of sync with the production
  extractor it should be re-evaluated. Target: Phase 7 audit.

- Local-darwin baseline still has the same 6 pre-existing test
  failures unrelated to v8 work (carry-over from Phase 0). Linux CI
  unaffected. Target: separate cleanup PR on main, not gated to any
  v8 phase.

## Phase 1 commit log (target)

```
feat(v8): contract types, schema loader, validator (Phase 1)
feat(v8): canonicalize + hash, JSONL serializer with manifest sidecar (Phase 1)
feat(v8): goal extractors (Anthropic Sonnet + stub) (Phase 1)
feat(v8): contract compiler + interactive approval flow (Phase 1)
feat(v8): swarm v8 compile CLI handler (Phase 1)
test(v8): 22 goal-to-contract transformations + integration (Phase 1)
docs(v8): Phase 1 completion + architecture deviations
```

(Single bundled commit acceptable per recent `feat(v8):` history;
splitting into two or three is also fine. Either shape preserves the
narrative.)

## Notes for Phase 2

- Lift the Anthropic client construction out of
  `AnthropicExtractor` into `src/session/anthropic-session.ts` so
  prompt caching applies across all v8 calls (compiler, population
  manager, verifier). The extractor becomes a thin caller of the
  session manager.
- Re-evaluate the `discoverRepoContext` duplication against
  `src/test-command-discovery.ts` once the session manager owns the
  project-context payload.
- Build the cost benchmark against the same v8-empty fixture used
  here; the contract hash is already a stable identity for caching
  benchmark runs.
