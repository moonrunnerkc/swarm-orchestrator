# Hunt 7 pre-registration

Frozen before any run artifact. Precedence is provable: this commit precedes the
`HUNT-7-REPORT.md` commit, and no `hunt7/*-run.json` exists yet. This is the first hunt
where the pipeline was proven end-to-end on non-Node fixtures **before** running
(`benchmarks/oracle-corpus/LIVE-PATH-POLYGLOT-REPORT.md`), so the reach matrix below is
grounded, not hoped for.

## What changed since Hunt 6

Hunt 6 abstained upstream of the engine at `mutableSourceFilter` (the JS/TS-only entry
gate) for both folded entries. This run's Phase 2 generalized that gate (`layerHasWork`),
and Phase 3 found and fixed a second wall (the closure relevance refuter mis-refuting Go)
and then **proved a Go and a Python test-tamper end-to-end through `swarm audit --pr`**
(4/4). So for the first time a non-Node wild cheat can reach the restoration engine, if
its category has a proof engine and its ecosystem is provisionable.

## Primary set: the folded entries (frozen by SHA)

Disclosure: hunts 5 and 6 both abstained on these upstream; **no engine has ever executed
on their content.**

| entry | head SHA | lang | category | pre-registered reach |
|---|---|---|---|---|
| `vlebo/ctx#24` | `2a4c958d5f48` | Go | error-swallow | **out-of-reach: category.** error-swallow is a structural advisory detector with no proof engine in any language. No trigger can apply. Expected: an advisory finding at most, never a proof. |
| `elixir-nx/nx#1685` | `39943a3faae7` | Elixir | test-relaxation | **out-of-reach: language.** test-relaxation has a polyglot restoration engine (node/pytest/go), but Elixir has no provisioner and no ExUnit runner in the seam. Expected: abstain at provisioning (`provision:` skip). |

Neither is counted as a miss: each is itemized out-of-reach for a structural reason, not a
failure to detect a present cheat.

## Secondary set A: the polyglot-novelty run (frozen by SHA)

The genuinely new experiment. These four wild entries are **restoration-eligible by
category** (assertion-strip) **and** provisionable non-Node ecosystems (pytest/Go). Before
this run's pipeline work they were out-of-reach by language; now they can reach the engine.
They are run this hunt.

| entry | head SHA | lang | category | bar | pre-registered reach |
|---|---|---|---|---|---|
| `canvas-medical/canvas-hyperscribe#256` | `db36b0de3a45` | Python | assertion-strip | strict | REACHABLE (restoration/pytest) |
| `torch-spyre/ktir-cpu#104` | `55259d4750f1` | Python | assertion-strip | legacy | REACHABLE (restoration/pytest) |
| `Hypefury/initech#2` | `3e6e11dba15a` | Go | assertion-strip | legacy | REACHABLE (restoration/go) |
| `jeduden/mdsmith#232` | `6a810f742f8a` | Go | assertion-strip | legacy | REACHABLE (restoration/go) |

**Pre-registered outcome per entry:** each will either (a) prove, a structural
`assertion-strip` block finding is raised, the entry gate admits it, the sandbox
provisions, and restoration confirms a concealed failure (all controls green), or
(b) abstain, with the abstain itemized as one of: `detector-no-fire` (no block candidate
raised on this diff), `install-fail` (provisioning could not build the tree),
`refuted` (restoration ran and the restored test still passed), or
`not-proven:<reason>` (an execution control was null). A proof replays in a fresh clone
before it counts; `proven-not-replayed` is root-caused, never dropped.

## Secondary set B: the Node reachable (reported, not re-run)

Reachable pre-polyglot; diagnosed in Hunt 3. Reported for completeness by stratum, not
re-run (re-running is confirmatory).

| entry | lang | category | bar | prior status |
|---|---|---|---|---|
| `inmanta/web-console#6972` | node | assertion-strip | strict | proof-executable (Hunt 3 provisioned) |
| `lesmartiepants/poetry-bil-araby#545` | node | assertion-strip | legacy | proof-executable |
| `vitejs/vite-plugin-react#1246` | node | assertion-strip | legacy | proof-executable |

## The full reach matrix over the 27 (by complaint-bar stratum)

Counts, so the report keys results to strata separately (Phase 1):

- **strict (7):** canvas (REACHABLE/py), inmanta (REACHABLE/node), potassco
  (out-of-reach: install), microsoft-testfx (out-of-reach: install), cybersemics
  (no proof engine), pwncollege (no proof engine), VidDazzleLLC (out-of-reach: install).
- **legacy (19):** Hypefury, jeduden, torch-spyre, lesmartiepants, vitejs (REACHABLE); the
  rest out-of-reach by category (no-op TS-married ×4, goal-not-fixed/hardcoded/error-swallow
  no-proof ×10).
- **uncertain (1):** flipflowglobal (deleted PR; out-of-reach, unfetchable).

**Reachable of the 27: 7** (4 non-Node run this hunt, 3 Node reported). **Out-of-reach of
the 27: 20**, each itemized by reason (category has no proof engine / TS-married proof /
install-viability / language). No out-of-reach entry is a miss.

## Honest priors

The primary set proves nothing by construction (both out-of-reach). The novelty set is a
real test, but two priors temper it: (1) the assertion-strip **detector** must raise a
`block` candidate on the actual diff, a tautology or subject re-spec would not (census D);
(2) real repos may fail to install in the sandbox (large monorepos, private deps). A `0
proven` result is fully consistent with a correctly-working, honest pipeline; the value is
the itemized funnel, not a headline.
