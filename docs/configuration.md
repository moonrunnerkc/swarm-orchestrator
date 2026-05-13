# Configuration

Every configurable surface, ordered by category. Precedence is the same
everywhere: CLI flag, then environment variable, then config-file key, then
built-in default.

## Provider selection

| Flag | Env var | Config-file key | Default | Values |
|---|---|---|---|---|
| `--extractor` | `EXTRACTOR_PROVIDER` | `provider.extractor` | `deterministic` | `deterministic` / `local` / `anthropic` |
| `--session` | `SESSION_PROVIDER` | `provider.session` | `deterministic` | `deterministic` / `local` / `anthropic` |

## Deterministic extractor

| Flag | Env var | Default | Purpose |
|---|---|---|---|
| `--contract-file <path>` | — | none | YAML or JSON contract file |
| `--contract-module <path>` | — | none | TS/JS module exporting a default contract |

At least one must be set when the extractor is `deterministic`. Selection
priority within the deterministic provider: file → module → inline (config
block).

## Deterministic session

| Flag | Env var | Default | Purpose |
|---|---|---|---|
| `--external-patches-dir <path>` | `EXTERNAL_PATCHES_DIR` | none | watched directory of JSON envelopes |
| `--external-patches-queue <path>` | `EXTERNAL_PATCHES_QUEUE` | none | JSONL queue of envelopes |
| `--external-patches-stdin` | — | off | read envelopes from stdin |
| `--external-patches-timeout-ms <n>` | — | 30000 (complete), ∞ (stream) | wait before failing |

At least one source must be selected when the session is `deterministic`.

## Local provider (extractor + session)

| Flag | Env var | Config-file key | Required | Default | Purpose |
|---|---|---|---|---|---|
| `--local-backend <name>` | `LOCAL_LLM_BACKEND` | `provider.local.backend` | yes | none | `openai-compatible` / `ollama` / `llama-cpp` / `vllm` |
| `--local-base-url <url>` | `LOCAL_LLM_BASE_URL` | `provider.local.base_url` | yes | none | endpoint URL |
| `--local-model-extractor <id>` | `LOCAL_LLM_MODEL_EXTRACTOR` | `provider.local.model_extractor` | yes if extractor=local | none | model id for the extractor |
| `--local-model-session <id>` | `LOCAL_LLM_MODEL_SESSION` | `provider.local.model_session` | yes if session=local | none | model id for the session |
| `--local-persona-model-map <p\|json>` | — | `provider.local.persona_model_map` | no | empty | persona id → model id map |
| `--local-grammar <mode>` | `LOCAL_LLM_GRAMMAR` | `provider.local.grammar` | no | `auto` | `auto` / `gbnf` / `json-schema` / `outlines` / `none` (see grammar-capability matrix below) |
| `--local-api-key <key>` | `LOCAL_LLM_API_KEY` | — | no | none | bearer token, if the endpoint needs one |
| `--local-seed <n>` | `LOCAL_LLM_SEED` | `provider.local.seed` | no | `0` | sampling seed |
| `--local-request-timeout-ms <n>` | `LOCAL_LLM_REQUEST_TIMEOUT_MS` | `provider.local.request_timeout_ms` | no | `120000` | per-request timeout |
| `--local-max-concurrency <n>` | `LOCAL_LLM_MAX_CONCURRENCY` | `provider.local.max_concurrency` | no | `1` | concurrent backend requests |

See [docs/providers.md](providers.md) for backend-specific details.

### Grammar capability matrix

The single `--local-grammar` flag feeds two independent consumers. Each
consumer accepts a different subset:

| Consumer | Accepted grammar values |
|----------|-------------------------|
| extractor | `auto`, `json-schema`, `none` |
| session | `auto`, `gbnf`, `json-schema`, `outlines`, `none` |

Values outside a consumer's accepted set are coerced to `auto` for that
consumer with a single startup warning to stderr naming the flag, the
value, the consumer, and the effective value. The run still succeeds.
The peer consumer continues to honor the requested value when it can.

## Anthropic provider

| Flag | Env var | Default | Purpose |
|---|---|---|---|
| `--api-key <key>` | `ANTHROPIC_API_KEY` | none | required when provider=anthropic |
| `--model <id>` | — | Sonnet-class default | model id override |
| `--temperature <n>` | — | 0 | sampling temperature override |

## Run-time flags (provider-agnostic)

See `swarm run --help` for the full list. Highlights:

- `--mode single|tournament`
- `--candidates <n>` (tournament only)
- `--ledger <path>` / `--run-id <id>` / `--result <path>`
- `--falsifiers on|off`
- `--cost-cap <usd>`
- `--no-streaming` / `--no-post-merge` / `--no-pre-generation` /
  `--no-deterministic`

## Precedence chain: flag > env > config > default

Every configurable surface resolves the same way: the CLI flag wins if
supplied; if not, the matching environment variable wins; if neither is
set, the `provider:` block in `.swarm/config.yaml` is consulted; if no
source supplies a value, the built-in default takes over.

Worked example for `--local-base-url` / `LOCAL_LLM_BASE_URL` /
`provider.local.base_url`:

```yaml
# .swarm/config.yaml
provider:
  local:
    base_url: http://config.local:1111/v1
```

```bash
# Source 1 only: config wins. base_url = http://config.local:1111/v1
swarm run .swarm/contracts/<id> --session local

# Source 1 + 2: env wins over config. base_url = http://env.local:2222/v1
LOCAL_LLM_BASE_URL=http://env.local:2222/v1 \
  swarm run .swarm/contracts/<id> --session local

# Source 1 + 2 + 3: flag wins over both. base_url = http://flag.local:3333/v1
LOCAL_LLM_BASE_URL=http://env.local:2222/v1 \
  swarm run .swarm/contracts/<id> --session local \
    --local-base-url http://flag.local:3333/v1
```

Defaults apply only when every higher-priority source is unset, and only
where the prompt's `LOCAL_LLM_GRAMMAR` (`auto`),
`LOCAL_LLM_REQUEST_TIMEOUT_MS` (`120000`), `LOCAL_LLM_MAX_CONCURRENCY`
(`1`), and `LOCAL_LLM_SEED` (`0`) defaults are defined. Every other
local-provider field has no default: a missing value at the bottom of
the chain produces a fail-loud error.

## Worked examples

### Deterministic (default; three sources, one effective configuration)

CLI flag:
```bash
swarm compile "ship the v2 endpoint" \
  --contract-file ./contracts/v2.yaml
```

Environment variable:
```bash
EXTRACTOR_PROVIDER=deterministic \
swarm compile "ship the v2 endpoint" --contract-file ./contracts/v2.yaml
```

Config file (planned `.swarm/config.yaml`):
```yaml
provider:
  extractor: deterministic
  contract: { file: contracts/v2.yaml }
```

All three produce the same effective configuration.

### Local

```bash
export LOCAL_LLM_BACKEND=ollama
export LOCAL_LLM_BASE_URL=http://localhost:11434
export LOCAL_LLM_MODEL_EXTRACTOR=<your-chosen-model>
export LOCAL_LLM_MODEL_SESSION=<your-chosen-model>
swarm compile "<goal>" --extractor local
swarm run .swarm/contracts/<id> --session local
```

### Anthropic

```bash
export ANTHROPIC_API_KEY=sk-ant-...
swarm compile "<goal>" --extractor anthropic
swarm run .swarm/contracts/<id> --session anthropic
```

## Existing configuration surfaces

These are not new; documented here for completeness.

- **Verification battery weights and thresholds**: `.swarm/gates.yaml`;
  schema in `src/verification/composite-score.ts`.
- **Built-in quality gates**: [`docs/quality-gates.md`](quality-gates.md);
  defaults in `config/quality-gates.yaml`.
- **Agent profiles**: `config/default-agents.yaml`, `agents/worker.agent.md`,
  `agents/reviewer.agent.md`.
- **Env-file precedence**: project `.env`, then orchestrator install `.env`,
  then `~/.env`. See [CLAUDE.md](../CLAUDE.md) "Config precedence."
