# Polyglot provisioning and reach (Stage 1)

Two deterministic, model-free reach builds: an executable-fraction metric per
intake, and a census-rank provisioner decision. Neither spends a model call.

## Executable-fraction metric

`npm run executable-fraction` computes, from the committed intake and the
committed EG-viability screen (offline, no network), the share of candidates the
execution-grounded proof tier can actually run against. A candidate is
proof-executable when the screen marked it viable AND its ecosystem carries at
least one proof engine. After the polyglot reach work that set is
**{node, python, go}**; every other ecosystem is recorded non-executable, never
silently dropped. Output: `benchmarks/real-corpus/executable-fraction.json`.

Every candidate lands in exactly one of three buckets, which sum to the total:

- **proof-executable**: viable and its ecosystem has an engine;
- **provisionable-gap**: an engine-backed ecosystem the screen could not
  provision (no lockfile / no test runner);
- **non-executable**: an ecosystem with no proof engine (`unrecognized`, elixir).

Current values:

| scope | proof-executable | total | fraction | by ecosystem |
|---|---|---|---|---|
| current intake (`mined-candidates-reach`) | 2 | 6 | 33.3% | python 1, node 1 |
| corpus (EG-viability screen) | 78 | 197 | 39.6% | python 52, go 14, node 12 |

The intake's other 4: 2 unrecognized (`ManifoldKit`, `qBittorrent`), 2 node
provisionable-gap (`harvey-cash` no runner, `import-js` no lockfile). Regenerate:
`npm run executable-fraction` (add `--intake <file>` for another intake).

## Census-rank provisioner decision (bounded-and-honest)

The plan ranks new provisioners by corpus census and applies the stop rule: a
category costing more than its corpus frequency justifies is recorded and skipped.
The census (from the frozen v3 dataset + the EG screen; full table in the
capability evidence report) by ecosystem over the 29-entry corpus:

| ecosystem | corpus entries | provisioned? |
|---|---|---|
| node (JS/TS) | 9 | yes |
| python | 5 | yes |
| go | 3 | yes |
| unrecognized (null) | 11 | n/a (mixed: C#/.NET, C++, Odoo-Python, deleted, obscure) |
| elixir | 1 | no |

**Rank 1, Elixir/mix: stop-rule skip.** Elixir is the only unprovisioned
recognized ecosystem, and it is a **singleton** (`elixir-nx/nx#1685`, the one
folded entry blocked on it). Building a sound Elixir provisioner costs an
Erlang/OTP + Elixir toolchain (absent on this machine), a locked ExUnit
failure-identity parser, and an ExUnit assertion grammar the detector does not yet
cover (Hunt 7 showed `\bassert\b` does not match `assert_all_close`). The Stage 1
gate requires validating a provisioner through the live path; with no toolchain to
run `mix`, that validation is impossible here. Cost far exceeds a frequency-1
justification: **recorded and skipped.**

**No next category clears the bar.** The stop rule then asks for the next
ecosystem the corpus shows twice or more. There is none: every unprovisioned
language appears exactly once (Elixir ×1, C#/.NET ×1 `microsoft/testfx`, C++ ×1
`potassco/clingcon`); the remaining `unrecognized` entries are either actually
Python (`GoliattCo/odoo-custom`, no pytest signal) or too obscure/deleted to
classify. Merging the mined-candidate set does not create a within-set 2+ cluster
either. So no new provisioner is justified this run; the executable frontier stays
{node, python, go}, and the metric above tracks it.

## Wild-target reach: vlebo/ctx#24 (error-swallow engine)

The disclosed first live target ran through the shipped `swarm audit --pr`
(`benchmarks/real-prs/error-swallow/vlebo-ctx-24.json`, deterministic). Full
funnel:

- **Provisioning:** attempted and succeeded (the Go module provisioned).
- **Detector:** 0 findings. The PR's "error swallow" is a **removed Go
  validation-return guard** (`if t.Target == "" { return fmt.Errorf(...) }`
  deleted from `internal/config/context.go`), not an empty catch / `except: pass`.
  The error-swallow detector's grammar (catch `{}` / `except: pass`) does not match
  a deleted return, so it raises no candidate.
- **Engine:** 0 applicable, 0 executed (no proof candidate reached the tier).
- **Verdict:** PASS, gate exit 0. Out-of-reach by category-grammar, recorded.

This is honest reach, not a miss: the error-swallow restoration engine
(this stage) neutralizes catch/except swallows, which the twins prove 4/4
(`benchmarks/twins/ERROR-SWALLOW-PROOF-REPORT.md`); a Go removed-validation-return
is a different shape (closer to a removed-guard restoration), out of the
error-swallow engine's bounded scope. Extending detection + a sound neutralization
to Go removed-return guards is recorded future work, not built this run.

## Spend

USD 0.00. The metric and census are offline over committed artifacts; the vlebo
funnel is one deterministic `swarm audit --pr` (GitHub API + Go clone, no judge).
