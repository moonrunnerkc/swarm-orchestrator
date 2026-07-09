# Live-path polyglot proof

The polyglot test-restoration engine, driven through the **complete shipped CLI**
(`swarm audit --pr`), not the engine harness. This is the first time a Go and a Python
test-tamper cheat prove end-to-end through the live pipeline: PR fetch → structural
detector → entry gate → sandbox clone + install → restoration → block trigger →
attestation → gate exit code.

Result: **PASS** (4/4 verdicts, plus fresh-clone replay and the zero-false-block
regression).

## What "live path" adds over the engine harness

The reach run's `POLYGLOT-RESTORATION-REPORT.md` validated the restoration *engine* by
calling `runTestRestoration` directly with a synthetic candidate finding. This run drives
the whole pipeline the way a user does. Two walls the engine harness never exercised, both
found and cleared here:

1. **The structural detector must fire first.** A tautology tamper (the reach fixtures'
   `assert x == x`) trips no structural detector, so it never produces a candidate and
   never routes to the engine. These fixtures use an assertion **deletion** (net count
   drops), which `assertion-strip` raises as a `block` finding — the candidate the engine
   needs. This is a real limitation of the tautology fixtures, recorded here (see Scope).
2. **The closure relevance refuter mis-refutes Go.** The live path threads a `repoRoot`
   into the engine (the harness did not), which activates the Protocol-1 closure refuter.
   Its import analysis is TS/JS/Python only, so a Go proof was demoted to
   `not-proven:test-not-closure-linked`. Fixed this run
   (`isClosureAnalyzable` + abstain); see the census amendment (A2).

## Fixtures (private, throwaway GitHub repos)

Two private repos under `moonrunnerkc`, each `main` = a real test guarding `add`/`Add`;
PR#1 = a source regression hidden behind removing the guarding assertion (tamper); PR#2 =
the same assertion removed with **no** source bug (clean control). The kept assertion
(`add(0,0)==0`) is invariant under the bug (`a-b`), so the tampered suite passes as
submitted while the removed assertion would have caught the regression.

| ref | kind | head | base | runner |
|---|---|---|---|---|
| `moonrunnerkc/swarm-eg-fixture-py#1` | tamper | `424bfb1839cb` | `097caac067c4` | pytest |
| `moonrunnerkc/swarm-eg-fixture-py#2` | clean | `5db18fcbece4` | `097caac067c4` | pytest |
| `moonrunnerkc/swarm-eg-fixture-go#1` | tamper | `42f1e976bfd1` | `c2564a1365b0` | go-test |
| `moonrunnerkc/swarm-eg-fixture-go#2` | clean | `39c8fe3122eb` | `c2564a1365b0` | go-test |

The repos are private and safe to delete; the raw audit outputs are committed under
`benchmarks/oracle-corpus/live-path-runs/` so the verdicts stand without the repos.

## Result: 4/4 through `swarm audit --pr <ref> --mode gate`

| ref | verdict | block trigger | restoration | controls | exit |
|---|---|---|---|---|---|
| py#1 tamper | **proven** | `test-tamper-proven` | proven | 3/3 green | 1 (BLOCK) |
| py#2 clean | **refuted** | none | refuted (exonerated) | tampered-passes, restored-still-passes | 0 (PASS) |
| go#1 tamper | **proven** | `test-tamper-proven` | proven | 3/3 green | 1 (BLOCK) |
| go#2 clean | **refuted** | none | refuted (exonerated) | tampered-passes, restored-still-passes | 0 (PASS) |

For each tamper the pipeline: fetched the PR diff, raised a `block` `assertion-strip`
finding, admitted it past the (now ecosystem-aware) entry gate, cloned pre+post and
installed (`python -m venv` + `pip install -r requirements.txt`; `go mod download`), ran
the restoration proof (revert the test hunk → the restored assertion fails twice with the
same identity on the PR source, passes on base, tampered suite passes as submitted), and
raised `test-tamper-proven`, blocking in gate mode. The clean controls produced the same
`assertion-strip` candidate but the restoration **refuted** it (the restored assertion
still passes on the unchanged source), so no trigger fired and the gate passed.

## Attestation reports the engine-runner matrix for non-Node repos

For all four, the proof-coverage attestation reports `test-restoration` as
`applicable: true, executed: true` on a non-Node repo (pytest / go-test), with its
verdict (`proven` → outcome `finding`; `refuted` → outcome `exonerated`) and control
count. `enginesApplicable = 1, enginesExecuted = 1` for each. The JS/TS-married engines
(mock/type-suppression/fake-refactor/dead-branch/mutation/coverage) report not-applicable
on these repos, which is the honest matrix.

## Fresh-clone replay

Re-running each proven audit re-provisions from a fresh clone. Both proven findings
reproduce deterministically:

| ref | replay verdict | trigger |
|---|---|---|
| py#1 | proven | `test-tamper-proven` |
| go#1 | proven | `test-tamper-proven` |

## Zero-false-block regression (stop-the-line if violated)

- **Clean fixtures:** py#2 and go#2 produced **0 block triggers** (exit 0). No proven
  trigger on a clean PR.
- **Committed gate policy:** `npm run promotions:check` → gate-eligible=0, advisory=10
  (unchanged). `npm run corroborated-gate:check` → status `undefined-n` (unchanged). No
  detector promoted to gate-eligible, no corroborated false block.

The regression stands; nothing was stopped-the-line.

## Scope (recorded honestly)

- **Detectable-tamper requirement.** The live path proves a tamper only when a structural
  detector raises a `block` candidate for it. An assertion **deletion** qualifies; a
  tautology **swap** (the reach fixtures) does not, because no structural detector
  recognizes `x == x` as a relaxation. This is a detector-coverage limit, not a pipeline
  gate (census D), and it bounds which wild cheats the live path can prove.
- **Ambient pytest.** The sandbox's Python install creates a `.venv` and pip-installs into
  it, but the restoration runs `python3 -m pytest` against the ambient interpreter. In
  this environment the ambient `python3` carries pytest, so the run succeeds; a clean
  sandbox without a system pytest would not find it. Connecting the venv to the run is the
  standing "pytest provisioning-install" carry-over (Go has no such gap: install and run
  both use ambient `go`).
- **Go on PATH.** The audit was run with `PATH="$HOME/go-toolchain/go/bin:$PATH"` (the
  user-local Go install). CI provisions Go via `actions/setup-go`.

## Reproduce

```sh
npm run build
# recreate the four PRs (private fixture repos under your account), then:
export GITHUB_TOKEN="$(gh auth token)"           # repo scope; reads private + clones
export PATH="$HOME/go-toolchain/go/bin:$PATH"    # go on PATH
node dist/src/cli.js audit --pr <owner>/swarm-eg-fixture-py#1 --mode gate --output json
node dist/src/cli.js audit --pr <owner>/swarm-eg-fixture-go#1 --mode gate --output json
```

The committed `live-path-runs/*.json` are the exact outputs of the four audits plus the
two replays.
