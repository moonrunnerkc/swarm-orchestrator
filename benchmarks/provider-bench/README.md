# Provider-comparison benchmark

`provider-bench` runs the full compile + run + verify cycle against a
chosen extractor and session provider, then writes a side-by-side
report so different provider combinations can be compared on equal
ground.

The harness wires `--extractor` and `--session` through the same
factories the v8 CLI handlers use; the local-provider flags
(`--local-backend`, `--local-base-url`, …) pass through verbatim.

## Usage

```bash
# Build the project so the dist artifacts the harness imports exist.
npm run build

# Single run against the deterministic provider (no network, no key).
node dist/benchmarks/provider-bench/provider-bench.js \
  --extractor deterministic --session deterministic

# Local provider (Ollama on the default port).
node dist/benchmarks/provider-bench/provider-bench.js \
  --extractor local --session local \
  --local-backend ollama \
  --local-base-url http://localhost:11434/v1 \
  --local-model-extractor qwen2.5-coder:14b \
  --local-model-session qwen2.5-coder:32b

# Side-by-side: run all three providers sequentially and produce one
# report that lists each row. Providers misconfigured for this host
# (e.g. anthropic with no API key) print a corrective error to stderr
# and a blank row in the report.
node dist/benchmarks/provider-bench/provider-bench.js --compare-providers
```

## Flags

| Flag | Effect |
|---|---|
| `--extractor <name>` | `deterministic` / `local` / `anthropic` (default `deterministic`) |
| `--session <name>` | Same set; default `deterministic` |
| `--compare-providers` | Run each of the three providers sequentially |
| `--out <dir>` | Output directory (default `benchmarks/provider-bench/out`) |
| `--local-*` | Every local-provider flag accepted by `swarm v8 compile` / `run` |

## Report shape

The harness writes `report.md` and `report.json` to the output
directory. Each row carries:

- `extractor`, `session` — provider names used
- `contractHash` — 12-character prefix of the compiled contract's
  manifest hash. The deterministic extractor produces identical hashes
  across runs of the same fixture; non-deterministic extractors do not,
  so this field is informational.
- `satisfied` / `failed` — verifier counts from the run result
- `wallTimeMs` — wall clock for compile + run
- `tokens` — input / cache-read / cache-write / output tokens from
  `totalUsage`
- `exitCode` — the run's exit code (0 = every obligation satisfied)

## Fixture

The harness uses an inline two-obligation YAML contract:

```yaml
obligations:
  - type: build-must-pass
    command: npm run build
  - type: test-must-pass
    command: npm test
```

against a synthetic workspace with `scripts.build` / `scripts.test`
both set to `true`. Both obligations satisfy via pre-generation
verification under any provider, so the wall-time and token columns
reflect only the inference overhead, not user-code work.

## What this measures

This is not a falsification-rate or capability benchmark. It is a
per-provider cost / wall-time snapshot under identical conditions.
For capability comparison, use the rubric and SWE-bench harnesses
documented at [../README.md](../README.md).
