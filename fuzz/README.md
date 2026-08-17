# fuzz

Coverage-guided harnesses for the two boundaries where something outside the harness
decides what the code sees: what a model returned, and what reaches the evidence ledger.
Run by crossfire through its Jazzer.js engine, and runnable on their own.

| Harness | Boundary | Invariant under test |
| --- | --- | --- |
| `adapter-output.fuzz.cjs` | a model's tool call arriving at the chokepoint | invariant 3: one execution path, nothing runs unrecorded, and no tool runs on input its schema rejected |
| `ledger-chain.fuzz.cjs` | entries reaching the evidence ledger | invariant 2: append-only and self-verifying, and a refused entry leaves the chain where it was |
| `swarm-toml.fuzz.cjs` | `swarm.toml` reaching the config parser | parsing settles as a config or a `MalformedSwarmTomlError`, and no input reaches `Object.prototype` |

The TOML one earns its place differently from the other two: a scanner alleged prototype
pollution in `valueAt`, and the refutation on record is a probe someone ran once.
Jazzer.js's prototype-pollution detector is on by default, so every input re-runs that
refutation. The detector was confirmed to fire here by injecting a real pollution into the
build and watching the harness report it.

## Why there is a build step

Jazzer.js instruments what it loads through `require`, and its require hook does not
understand TypeScript. Imported directly, `src/**/*.ts` loads but is never instrumented:
the fuzzer then runs blind, which looks exactly like a run that found nothing. Measured on
the same harness and budget, blind is `cov: 3` and coverage-guided is `cov: 37`.

`npm run fuzz:build` emits `src` to `.swarm/fuzz-build` as JavaScript with inline source
maps. The harnesses require that, so Jazzer.js instruments it, and the inline maps mean a
crash still reports its location in the original `.ts`.

## Running one

```sh
npm run fuzz:build
mkdir -p .swarm/corpus && cp fuzz/corpus/ledger-chain/* .swarm/corpus/
node_modules/.bin/jazzer fuzz/ledger-chain.fuzz.cjs .swarm/corpus \
  -- -max_total_time=60 -artifact_prefix=.swarm/
```

Fuzz a copy, not `fuzz/corpus` itself: the fuzzer writes every interesting input it
finds back into the directory it was given, so pointing it at the seeds buries them in
a few hundred generated files. crossfire copies the corpus to a temp directory for the
same reason. `-artifact_prefix` keeps crash files out of the repo root the same way.

Exit 77 is a crash, and the input that caused it lands in `.swarm/crash-<sha1>`.

## The smoke check

```sh
node fuzz/smoke.mjs
```

Loads every harness and runs it once over each of its own seeds. A harness that throws on
startup, or one built against a stale `.swarm/fuzz-build`, produces the same clean output
as a harness that genuinely found nothing, so `fuzz:build` runs this before handing
anything to the fuzzer.

## Corpora

Each corpus holds realistic valid inputs plus malformed ones, so the fuzzer starts inside
the shapes the code actually accepts rather than having to discover them. Seeds are read
as one model turn: JSON where it parses, raw text where it does not.
