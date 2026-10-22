# Self-hosted-runner verification, a repair-trace trial, and a fresh three-arm comparison, 2026-10-22

Registered in [protocol.md](protocol.md) before any inference (`d0bbe363b`), every launch in
[launches.md](launches.md). Product frozen at `06531fb5e`; model `qwen3.6:35b-a3b` on Ollama
0.32.14 for every arm; OpenCode 1.14.48. Eight launch slots: seven ran, one halted before dispatch;
44.4 of 90 agent-minutes used; nothing relaunched.

## Did Swarm produce better complete artifacts?

**No.** On the one fresh task any arm completed (entities), Swarm's and OpenCode's delivered trees
are equivalent under the registered definitions: both correct and complete. On the other (acorn), no
arm delivered a correct tree. On the development pair, both Swarm arms delivered the same faulty
candidate. Nothing here shows Swarm producing a better artifact than OpenCode, and the repair trace
produced no artifact improvement.

## Results by task (scored on each exact delivered tree)

| task | arm | required and preserved behaviour (hidden check) | hidden oracle | visible check, project tests | meaningful added tests | artifact |
| --- | --- | --- | --- | --- | --- | --- |
| entities: restore `getCodePoint` | Swarm control (launch 7) | 22 of 22 | pass | pass, pass | 6 (all fail over the base's source) | **correct and complete** |
| entities | OpenCode (launch 5) | 22 of 22 | pass | pass, pass | 6 | **correct and complete** |
| entities | Swarm trace (launch 6) | halted before dispatch by a harness preflight defect; no inference | | | | unmeasured |
| acorn: member-target pattern errors | Swarm control (launch 2) | 21 of 31 (no change: the base) | fail | fail | 0 | not correct (nothing changed) |
| acorn | Swarm trace (launch 3) | 21 of 31 (no change) | fail | fail | 0 | not correct (nothing changed) |
| acorn | OpenCode (launch 4) | 13 of 31: breaks valid destructuring the base parses | fail | fail | 0 | not correct (an unfinished debugging state, killed at the deadline) |
| development pair: retained alias candidate | Swarm control (launch 0) | frozen check fails; expanded check 10 of 11 | fail | fail | 0 | not correct (repair rolled back) |
| development pair | Swarm trace (launch 1) | the same tree | fail | fail | 0 | not correct (repair rolled back) |

Beside the registered criteria, the project checks on every tree, pre-existing failures apart:
entities' base has no lint errors; Swarm's delivered tree has none (its first candidate had three,
which its repair fixed); OpenCode's tree introduces lint errors. acorn's base lint is clean;
OpenCode's tree introduces twelve. Under the registered rule this does not make either entities
artifact better.

**Repair: first candidate against delivered.** Launch 7: the first candidate (rebuilt to its
recorded digest) was already correct and complete; the repair fixed lint and was accepted:
**preserved**. Launches 2 and 3: no edit, no repair. Launches 0 and 1: both repairs reached a
tests-passing tree with a new format failure and were rolled back: the delivered tree is the first
candidate, **preserved** (unchanged); the rolled-back trees are not reconstructed
([development-pair/README.md](development-pair/README.md)).

**Product verdict accuracy.** Swarm's report matched its artifact in every dispatched launch: it
accepted and claimed the correct entities tree (launch 7) and refused, without a claim, every tree
that was not correct (0, 1, 2, 3). OpenCode claimed completion on its correct entities tree and was
killed without a claim on acorn.

**Cost.**

| launch | arm | wall | model time | verification time | tokens |
| --- | --- | --- | --- | --- | --- |
| 0 | Swarm control (dev) | 511.3 s | 108.1 s | 256.9 s | 837,049 (lower bound: 1 call unreported) |
| 1 | Swarm trace (dev) | 415.6 s | 69.0 s | 226.7 s | 491,992 |
| 2 | Swarm control (acorn) | 462.9 s | 198.2 s | 101.9 s | 1,086,391 |
| 3 | Swarm trace (acorn) | 497.8 s | 242.1 s | 76.0 s | 997,395 |
| 4 | OpenCode (acorn) | 540.5 s (killed) | 502.2 s model and client (38.3 s tools) | none | 4,740,151 |
| 5 | OpenCode (entities) | 42.6 s | 42.5 s model and client | none | 263,116 |
| 7 | Swarm control (entities) | 191.8 s | 92.6 s | 45.9 s | 815,416 |

On entities Swarm took 4.5 times OpenCode's wall and 3.1 times its tokens for an equivalent
artifact. On acorn each Swarm run spent 74 and 94 s before its first model call (install with a
git-hosted test dependency, then the base preflight), used all 40 steps of its first loop reading
the parser without an edit, and had no wall left for a repair or the owed continuation.

## The four questions

1. **Can Swarm verify legitimate changes in a project that uses its own code as its test runner?**
   Now, yes, with a named residual: the upstream alias fix, which changes mocha's runner source,
   reads regression `pass` (before: `unmeasured`); an incorrect change and one that breaks lint still
   fail; a runner that swallows failures or skips a file is withheld; a changed test script is still
   judged by the base-configuration rule ([verification.md](verification.md)). Live, both
   development repairs' trees had their tests reading accepted by runner-source-v1 under the final
   verification. A legitimate change that rewrites existing expectations (the unparse task, and its
   upstream fix) is still withheld, by the separate expectation-change policy.
2. **Can verification overhead be reduced while keeping its guarantees?** For the debugging path,
   yes: `run_check` now runs the sealed checks alone, 8.8 s per call live against 76.9 s for the
   same call on 2026-10-21; the gate and final verifications are unchanged. Scoped and settled
   rereadings cut commands per mocha verification from 12–17 to 8–15; the runner-source witness adds
   two test runs where it applies. Reusing the gate cycle's verification as the final one was not
   done: those checks reach the network, so their inputs are not identified.
3. **Does one focused repair improvement turn a faulty candidate into a complete, correct change?**
   Not shown. The trace notice was given once (launch 1) and the model never used `compare_base`;
   on acorn no repair ran at all. The trace stays experimental and off.
4. **Does it transfer to fresh tasks and beat a Swarm control and OpenCode?** Not measurable here:
   on acorn neither Swarm arm reached a repair, and the entities trace arm halted on a harness
   defect before dispatch. Swarm control and OpenCode are equivalent on entities.

## Also in this stage

- [The 2026-10-21 alias correction](../2026-10-21/fresh-comparison/correction-2026-10-22/README.md):
  the OpenCode alias patch returns before the long-alias normalization (`--timeouts 200` throws,
  `--reporter-options a=b` and `--globals window` read `["true"]`, ESLint `no-unreachable`); under
  the task's broader requirements neither alias artifact is correct; the 2026-10-21 Swarm repair
  made no edit and its lint "regression" was the project's own order-dependent lint.
- [Task selection](fresh-tasks/selection-rule.md), written and committed before any candidate was
  read; scan, validation and hidden checks beside it.
- Harness defect found live: the runner's gate-plan preflight compared command strings and read the
  product's structured form of `npm run test:vi` as another gate; corrected before launch 7
  (protocol amendment 1).
- Remaining obstacles named by the runs, not fixed here: the expectation-change policy (unparse); a
  repair's tree rolled back for formatting with no wall left (development pair); acorn's first loop
  exhausting 40 steps without an edit; the workspace gate's lint still meets mocha's order-dependent
  docs check (only the independent verification's rereadings are settled).

## Records

- In this tree: the protocol, launches, selection and validation, hidden checks, scorers, drivers,
  and the pack `payloads/packed-derived/payloads` (runner records, patches, scores, lint readings,
  session accounts, OpenCode streams, development-pair records and briefs, verification-matrix
  summaries) and `packed-derived/records` (the runner's records, byte for byte).
- The five Swarm session bundles (about 0.9 MB packed) are on the branch
  `evidence/2026-10-22-sessions` of this repository, packed the same way, so this tree keeps the
  6.0 MB of weight headroom its checks require.

## Reproduction

    node scripts/evidence-pack.mjs restore docs/evidence/2026-10-22/payloads/packed-derived/payloads
    node scripts/evidence-pack.mjs restore docs/evidence/2026-10-22/packed-derived/records
    git fetch origin evidence/2026-10-22-sessions && git checkout FETCH_HEAD -- docs/evidence/2026-10-22/sessions
    node scripts/evidence-pack.mjs restore docs/evidence/2026-10-22/sessions/packed-derived/sessions
    node docs/evidence/2026-10-22/session-account.mjs <restored session directory>
    node docs/evidence/2026-10-22/opencode-account.mjs <restored runner record> <directory of restored streams>
    node docs/evidence/2026-10-22/score-tests.mjs --manifest docs/evidence/2026-10-22/control/manifest.json --task <id> --patch <patch> --out <json>
    node docs/evidence/2026-10-21/fresh-comparison/reconstruct-first.mjs --manifest docs/evidence/2026-10-22/control-amended/manifest.json --task entities-bugfix-restore-get-code-point --session <restored session> --out <dir>

The hidden behaviour checks run in a checkout of each task's base with the patch applied
(`node acceptance/hidden/behaviour-check.mjs` for acorn, `node --import=tsx
acceptance/hidden/behaviour-check.mts` for entities). The launches themselves:
`node scripts/comparison/run.mjs --manifest docs/evidence/2026-10-22/<cohort>/manifest.json --only
<task> --arm <arm>` with the pinned build, and the development pair with
`node docs/evidence/2026-10-22/development-pair/alias-repair-boundary.mjs`; inference is not
deterministic, so a rerun is a new sample.

## Limits

One model, one host, two small fresh tasks from two repositories plus one development pair, one
launch per arm. The entities task is a one-function restoration. The upstream fixes are public and
may be in the model's training data. The trace arm was measured on one task only, where its
procedure was not used.
