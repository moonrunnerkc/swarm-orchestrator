# Providers

The orchestrator's verification engine is provider-agnostic. Three providers
implement the `Extractor` and `Session` interfaces; the verifier, ledger,
manifest, canonicalization, falsifiers, snapshot/rollback, quality gates,
cost cap, and tournament logic do not depend on which provider is selected.

| Provider | Network | API key | Hardware | Best for |
|---|---|---|---|---|
| `deterministic` (default) | no | no | none | reproducible compile-time work; externally-sourced patches |
| `local` | localhost or your LAN | optional | whatever the model needs | model-driven patch generation without third-party APIs |
| `anthropic` | api.anthropic.com | `ANTHROPIC_API_KEY` required | none | baseline benchmarking; convenience |

Provider selection is per-call. The extractor and session can use different
providers independently. Selection is explicit; the orchestrator never falls
back silently between providers.

## Selection

Four sources, evaluated in order:

1. CLI flag (`--extractor <name>` / `--session <name>`)
2. Environment variable (`EXTRACTOR_PROVIDER` / `SESSION_PROVIDER`)
3. Config-file key (`provider.extractor` / `provider.session` in
   `.swarm/config.yaml`)
4. Built-in default (`deterministic`)

Misconfiguration is fail-loud. An invalid value lists the accepted names and
their purpose; missing required configuration (no contract input for the
deterministic extractor, no API key for the Anthropic provider, no base URL
for the local provider) reports what to set and where.

## Provider interface guarantees

Every shipped provider passes the parameterized Session contract battery
at `test/session/session-interface.contract.test.ts`. The battery exercises
each provider against the same six assertions:

- `complete()` returns a non-empty `SessionResponse` with the documented
  shape.
- `stream()` emits chunks in order and ends with the final text
  observable, completing without an abort flag when nothing intervenes.
- `projectContext()` returns the cached prefix unchanged.
- `totalUsage()` returns a typed `SessionUsage` with finite numeric
  fields even when the value is zero.
- A mid-stream `abort` from the observer terminates emission and the
  result reports `aborted: true` with the supplied reason.
- `providerInfo()` returns a `provider` identifier that matches the
  provider name.

A new provider that wants Session conformance must pass this battery.
Any provider that does is interchangeable at the `Session` boundary;
the orchestrator's verifier, ledger, and population manager treat all
of them identically.

## Deterministic

Accepts a structured contract directly in one of three forms (resolved in
this precedence order):

1. `--contract-file <path>` — YAML (`.yaml` / `.yml`) or JSON (`.json`). The
   file extension picks the parser. UTF-8 only.
2. `--contract-module <path>` — JavaScript module (`.js` / `.cjs`, or
   precompiled TypeScript) loadable by `require()`, exporting a default value
   matching `{ obligations: [...] }`. Raw `.ts` sources require an external
   loader.
3. Inline `contract` block in a project config file (forthcoming).

Validation uses the same JSON Schema every provider depends on
(`src/contract/extractor/contract-schema.ts`). A validation failure surfaces
the JSON pointer of the offending field, the failing rule, and a one-line
corrective action.

### Session input channels

The deterministic session reads externally-sourced patches from one of
three channels (resolved in this order):

1. `--external-patches-dir <path>` (or `EXTERNAL_PATCHES_DIR`) — watched
   directory; each file is a JSON envelope. Consumed files are moved to
   `<dir>/consumed/` so re-runs see the same input.
2. `--external-patches-queue <path>` (or `EXTERNAL_PATCHES_QUEUE`) — JSONL
   file; one envelope per line.
3. `--external-patches-stdin` — newline-delimited envelopes on stdin.

### Envelope shape

```jsonc
{
  "patch": "<FORMAT 1 | FORMAT 2 | FORMAT 3 text>",
  "persona": "architect",   // optional; routes a queued patch to a specific persona
  "source": "manual-fix-12" // optional; recorded in the ledger
}
```

The session validates the patch against the strict FORMAT 1/2/3 grammar
before emission. Invalid patches are rejected with an error that identifies
the malformed region; they never enter the verifier path.

### Timeouts

- `complete()`: defaults to 30000 ms; fails if no matching envelope arrives.
- `stream()`: defaults to wait indefinitely.
- Override both with `--external-patches-timeout-ms <n>`.

### Ledger fields

Every entry written by the deterministic session carries:

- `provider`: `"deterministic"`
- `modelId`: `null`
- `backend`: `null`
- `grammar`: `null`
- `seed`: `null`
- `source`: the envelope's `source` field (when present)
- `usageEstimated`: `false`

## Local

Talks to whatever endpoint you run. No model is hardcoded; no hardware is
assumed. Selecting `--extractor local` or `--session local` requires
configuring the backend and base URL.

### Backends

| Name | Endpoint | Grammar support | Cache mapping |
|---|---|---|---|
| `openai-compatible` | `POST /v1/chat/completions` | JSON Schema via `response_format` | `prompt_cache_hit_tokens` → `cacheReadTokens` |
| `ollama` | `POST /api/chat` | JSON Schema via `format` | opaque (no per-call hit count exposed) |
| `llama-cpp` | `POST /completion` | GBNF via `grammar` | opaque (`--cache-prompt` is server-side) |
| `vllm` | `POST /v1/chat/completions` | JSON Schema via `guided_json` | `cached_tokens` → `cacheReadTokens` |

### Configuration

| Key | Required | Default | Purpose |
|---|---|---|---|
| `LOCAL_LLM_BACKEND` | yes | none | one of `openai-compatible`, `ollama`, `llama-cpp`, `vllm` |
| `LOCAL_LLM_BASE_URL` | yes | none | endpoint URL; fail-loud if missing |
| `LOCAL_LLM_MODEL_EXTRACTOR` | yes if `extractor=local` | none | model id for the extractor call |
| `LOCAL_LLM_MODEL_SESSION` | yes if `session=local` | none | default model id for the session call |
| `LOCAL_LLM_PERSONA_MODEL_MAP` | no | empty | JSON map of persona id → model id; overrides the default |
| `LOCAL_LLM_GRAMMAR` | no | `auto` | `auto` / `gbnf` / `json-schema` / `outlines` / `none` |
| `LOCAL_LLM_REQUEST_TIMEOUT_MS` | no | `120000` | per-request timeout |
| `LOCAL_LLM_MAX_CONCURRENCY` | no | `1` | concurrent requests against the endpoint |
| `LOCAL_LLM_API_KEY` | no | none | bearer token if the endpoint requires auth |
| `LOCAL_LLM_SEED` | no | `0` | sampling seed; recorded in the ledger |

### Grammar negotiation

`LOCAL_LLM_GRAMMAR=auto` picks the strongest grammar mode the backend
reports as supported. The extractor targets the contract JSON Schema; the
session targets the unified-diff GBNF shipped at
`src/inference/local/grammars/unified-diff.gbnf`. When the backend
advertises no support for the requested mode, the session logs a warning
naming the backend and the chosen fallback, then proceeds.

### Grammar capability matrix

The single `--local-grammar` flag is consumed by two independent pieces.
Each accepts a different subset:

| Consumer | Accepted grammar values |
|----------|-------------------------|
| extractor | `auto`, `json-schema`, `none` |
| session | `auto`, `gbnf`, `json-schema`, `outlines`, `none` |

Values outside a consumer's accepted set are coerced to `auto` for that
consumer, with a single startup warning to stderr naming the flag, the
requested value, the consumer that cannot honor it, and the effective
value. Example:

```
warning: --local-grammar=gbnf does not apply to the extractor (extractor accepts: auto, json-schema, none); extractor will use 'auto'. Session will use 'gbnf' as requested.
```

The warning is informational. The run still succeeds, and the peer
consumer honors the requested value if it can. The warning fires only
when the affected consumer is actually in use (`--extractor local` /
`--session local`); no warning is emitted for deterministic or
anthropic providers because those branches do not read the grammar
value at all (so there is nothing to coerce).

### Determinism

The local provider passes `temperature: 0` and `seed: 0` (configurable via
`LOCAL_LLM_SEED`) on every call. The seed lands in the ledger entry so
"same goal + same workspace + same seed + same model + same backend version"
reproduces identically. Reproducibility is bounded by what the backend
itself honors — backends that do not honor the seed advertise this in their
documentation.

### Ledger fields

Every entry produced by the local session carries:

- `provider`: `"local"`
- `modelId`: the resolved model id (per-persona override applied)
- `backend`: the backend name
- `grammar`: the resolved grammar mode
- `seed`: the configured seed
- `source`: `null`
- `usageEstimated`: `true` when the backend did not report token counts

### Troubleshooting

- **Connection refused**: confirm the server is bound to `LOCAL_LLM_BASE_URL`'s
  host and port. Many servers default to `127.0.0.1` and reject LAN clients.
- **401/403**: set `LOCAL_LLM_API_KEY` if the endpoint expects a bearer
  token, even on localhost.
- **Grammar rejected**: re-run with `LOCAL_LLM_GRAMMAR=none`; if the failure
  disappears, the backend's grammar implementation is the cause.
- **Non-JSON from the local extractor**: the model isn't honoring the
  grammar request. Try a different model or set `LOCAL_LLM_GRAMMAR=none`
  and rely on the strict prompt fallback parser.

## Anthropic

Uses the Anthropic SDK with prompt caching and tool-use. The extractor
performs a single Sonnet-tier tool call with the shared contract schema as
the tool's input schema; the session caches the project-context prefix on
every call.

### Configuration

- `--api-key <key>` or `ANTHROPIC_API_KEY` (required).
- `--model <id>` (defaults to a Sonnet-class id; see `DEFAULT_SESSION_MODEL`
  in `src/session/anthropic-session.ts`).

### When to choose it

- Baseline benchmarking against a known-good model.
- Convenience for users without local infrastructure.
- Best-in-class prompt-cache pricing for repeated workloads.

### Ledger fields

Every entry produced by the Anthropic session carries:

- `provider`: `"anthropic"`
- `modelId`: the model id in use
- `backend`: `null`
- `grammar`: `null`
- `seed`: `null`
- `source`: `null`
- `usageEstimated`: `false`

## Cross-provider behavior

All three providers produce ledger entries with the same shape, identical
canonical contract bytes, and identical `contractHash` values when given
identical inputs. The benchmark harness (`benchmarks/`) runs the same
contract through each provider and compares satisfied-count and falsifier
catch rate so cross-provider quality is measurable.
