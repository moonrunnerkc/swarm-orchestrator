# CLI Reference

The package exposes two bin names, `swarm` and `swarm-orchestrator`, both pointing to `dist/src/cli.js`. The examples below use `swarm`.

Primary workflow commands are `bootstrap`, `swarm`, `run`, and `quick`.

## Global output flags

These flags are supported by commands that call the shared output parser:

| Flag | Effect |
| --- | --- |
| `--json` | Alias for `--output json` on supported commands. |
| `--output json` | Prints machine-readable JSON on supported commands. |
| `--verbose` | Enables debug logging for commands that thread logger verbosity. |
| `--help`, `-h` | Shows help for the root CLI or selected command. |

Support is command-specific. If a command does not call `parseOutputFormat`, it prints text only.

## Workflow commands

### `swarm bootstrap <path(s)> "Goal"`

Analyzes one or more repo paths, writes bootstrap evidence, and saves a plan.

```bash
swarm bootstrap ./repo "Add authentication"
swarm bootstrap ./api ./web "Add request tracing across services"
```

Artifacts:

```text
runs/bootstrap-<timestamp>-<slug>/bootstrap/analysis.json
plans/bootstrap-<timestamp>-<slug>
```

Execution flags such as `--tool` are ignored by bootstrap today. Pick the agent when executing the plan:

```bash
swarm swarm plans/bootstrap-<timestamp>-<slug> --tool codex
```

### `swarm swarm <planfile>`

Runs a plan through the verified branch and worktree workflow: per-step transcript capture, evidence verification, branch merge, and post-merge quality gates. Concurrency is greedy as-ready, with two ready steps running together only when the static dependency analyzer clears them.

```bash
swarm swarm plans/bootstrap-<timestamp>-<slug> --tool claude-code --yes
```

Flags:

| Flag | Description |
| --- | --- |
| `--tool <name>` | Adapter: `copilot`, `claude-code`, `codex`, or `claude-code-teams`. |
| `--model <name>` | Model override passed to the selected adapter. |
| `--target <dir>`, `--dir <dir>` | Run against a target directory instead of cwd. |
| `--resume <id>` | Resume a paused or failed swarm session. |
| `--pm` | Run PM agent plan review before execution. |
| `--strict-isolation` | Force per-task branch isolation and transcript-only context. |
| `--lean` | Enable the Delta Context Engine. |
| `--useInnerFleet`, `--wrap-fleet` | Prefix step prompts with `/fleet`. |
| `--hooks`, `--no-hooks` | Enable or disable per-step hook injection. Hooks default to enabled. |
| `--quality-gates-config <path>` | Override quality-gate config path. |
| `--quality-gates-out <dir>` | Override the gate report output directory. |
| `--no-quality-gates` | Disable the final quality-gate pass. |
| `--owasp-report` | Write OWASP ASI compliance report artifacts. |
| `--pr <auto|review>` | Create PRs instead of direct merge. |
| `--cost-estimate-only` | Print cost estimate and exit before execution. |
| `--max-premium-requests <n>` | Abort when estimated premium requests exceed the budget. |
| `--max-retries <n>` | Maximum retry attempts for queued and repair retries, default `3`. |
| `--yes`, `-y` | Skip the cost confirmation prompt. |

### `swarm run --goal "description"`

Generates a plan and executes it in one command.

```bash
swarm run --goal "Add unit tests for retry helpers" --tool codex --yes
```

`swarm run <planfile>` also executes an existing plan when the first positional argument resolves to a valid plan file.

Additional run-only flag:

| Flag | Description |
| --- | --- |
| `--agent-guidance <text>` | Prepends guidance to generated step tasks without changing goal classification. Used by benchmark harnesses. |

All `swarm swarm` execution flags are also parsed by `swarm run`.

### `swarm quick "task"`

Runs the single-agent quick-fix path for small tasks.

```bash
swarm quick "fix typo in README" --tool codex --yes
```

Flags:

| Flag | Description |
| --- | --- |
| `--tool <name>` | Adapter used for cost defaults. |
| `--model <name>` | Model override. |
| `--agent <name>` | Agent name override. |
| `--skip-verify` | Skip quick-fix verification. |
| `--yes`, `-y` | Skip the cost confirmation prompt. |

### `swarm execute <planfile>`

Starts the older sequential copy and paste execution guide.

```bash
swarm execute plans/example.json
```

Flags:

| Flag | Description |
| --- | --- |
| `--delegate` | Adds `/delegate` PR guidance to step prompts. |
| `--mcp` | Requires MCP evidence from GitHub context in verification prompts. |

## Planning commands

### `swarm plan <goal>`

Generates a local execution plan and saves it under `plans/`.

```bash
swarm plan "Build a REST API for user management"
swarm plan --output json "Build a REST API for user management"
```

### `swarm plan --copilot <goal>`

Prints a Copilot planning prompt instead of creating the plan locally.

```bash
swarm plan --copilot "Split auth into middleware and services"
```

Use `--output json` to print the generated prompt as JSON.

### `swarm plan import <runid> <transcript>`

Parses a plan from a Copilot `/share` transcript and saves it under `plans/`.

```bash
swarm plan import run-123 transcripts/planning-share.md
swarm plan import run-123 transcripts/planning-share.md --output json
```

## Verification and reports

### `swarm gates [path]`

Runs the advisory quality-gate engine on a repo path. Defaults to cwd.

```bash
swarm gates .
swarm gates . --output json
swarm gates . --quality-gates-config .swarm/gates.yaml
swarm gates . --quality-gates-out reports/gates
swarm gates . --base-commit HEAD~1
swarm gates . --sarif reports/swarm-gates.sarif
```

Flags:

| Flag | Description |
| --- | --- |
| `--output json`, `--json` | Print structured JSON. |
| `--quality-gates-config <path>` | Config path override. |
| `--quality-gates-out <dir>` | Report output directory. |
| `--base-commit <sha>` | Base commit for baseline-aware gates. |
| `--sarif <path or ->` | Write SARIF to a file or stdout. |

### `swarm status <execid>`

Shows sequential or swarm session status.

```bash
swarm status swarm-2026-04-29T12-00-00-000Z
swarm status swarm-2026-04-29T12-00-00-000Z --output json
```

### `swarm report <run-id>`

Generates report artifacts from an existing run directory.

```bash
swarm report swarm-2026-04-29T12-00-00-000Z
swarm report --latest --format md --stdout
```

Flags:

| Flag | Description |
| --- | --- |
| `--latest` | Use the most recent directory under `runs/`. |
| `--format <md|json>` | Output format. Default writes both when not using stdout. |
| `--stdout` | Print instead of writing `report.md` or `report.json`. |

### `swarm audit <session-id>`

Generates a Markdown audit report from saved session state.

```bash
swarm audit swarm-2026-04-29T12-00-00-000Z
```

### `swarm metrics <session-id>`

Shows session metrics.

```bash
swarm metrics swarm-2026-04-29T12-00-00-000Z
swarm metrics swarm-2026-04-29T12-00-00-000Z --output json
```

### `swarm attest verify <commit>`

Verifies a swarm attestation git note for a commit.

```bash
swarm attest verify HEAD
```

This is the only v7 falsification-battery CLI surface exposed today.

## Falsification adapter flags (v8 run)

`swarm v8 run` accepts `--falsifiers <on|off>` (default `on`). Setting
`off` short-circuits the falsification dispatcher entirely; adapter code
stays in tree but is never invoked.

**Production adapter set (final, post-2026-05-09 close-out):** Codex
and Copilot are default-on; ClaudeCode is behind a per-adapter flag
default-off. The CLI does **not** expose per-adapter on/off flags;
per-adapter selection is a registry-construction concern at the API
layer:

```ts
import { defaultAdapterRegistry } from '@swarm/falsification';

defaultAdapterRegistry();                              // Codex + Copilot
defaultAdapterRegistry({ includeCopilot: false });     // Codex-only
defaultAdapterRegistry({ includeClaudeCode: true });   // + same-family ablation arm
```

`includeCopilot` defaults to `true`; `includeClaudeCode` defaults to
`false`. The flags shape the registry the dispatcher walks; the CLI's
single `--falsifiers <on|off>` then gates dispatch as a whole.

See [docs/falsification-adapters.md](falsification-adapters.md) for the
subsystem overview (production topology, sandbox posture, dual-column
cost reporting, methodology-fix invariants),
[docs/adapter-integration.md](adapter-integration.md) for the
historical multi-phase plan, and [DECISIONS.md](../DECISIONS.md) for
the recorded architectural decisions and the 2026-05-09 "Adapter
integration close-out" entry.

## Transcript commands

### `swarm share import <runid> <step> <agent> <path>`

Imports a `/share` transcript and prints the extracted index.

```bash
swarm share import run-123 2 worker transcripts/step-2-share.md
```

### `swarm share context <runid> <step>`

Shows prior step context for a run.

```bash
swarm share context run-123 3
```

## Agent commands

### `swarm agents export`

Exports agent prompt files from base definitions or execution history.

```bash
swarm agents export
swarm agents export --output-dir agents --min-runs 10 --diff
```

Flags:

| Flag | Description |
| --- | --- |
| `--output-dir <dir>` | Output directory. Defaults to `agents/`. |
| `--min-runs <n>` | Minimum historical runs for data-driven export. Defaults to `5`. |
| `--diff` | Print detected changes against previous export. |

## Recipe commands

### `swarm recipes`

Lists built-in recipes.

```bash
swarm recipes
```

### `swarm recipe-info <name>`

Shows recipe details and parameters.

```bash
swarm recipe-info add-tests
```

### `swarm use <recipe>`

Parameterizes a built-in recipe, saves a plan, and executes it through swarm mode.

```bash
swarm use add-tests --param framework=mocha --tool codex --yes
```

Recipe parameters use repeated `--param key=value` arguments. `swarm use` also parses the same execution flags as `swarm swarm`.

## Demo commands

### `swarm demo <scenario>`

Runs a named demo scenario.

```bash
swarm demo demo-fast
```

### `swarm demo-fast`

Alias for `swarm demo demo-fast`.

```bash
swarm demo-fast
```

### `swarm demo list`

Lists demo scenarios.

```bash
swarm demo list
```

## Adapter auth

| Adapter | Install | Auth |
| --- | --- | --- |
| `copilot` | `npm install -g @github/copilot` | Run `copilot`, then `/login`. Requires Node.js 22 or newer. |
| `claude-code` | `npm install -g @anthropic-ai/claude-code` | Run `claude` for browser login, or set `ANTHROPIC_API_KEY`. |
| `claude-code-teams` | `npm install -g @anthropic-ai/claude-code` | Same auth as `claude-code`. Per-step adapter; orchestrator-level concurrency is gated by the static dependency analyzer. |
| `codex` | `npm install -g @openai/codex` | Run `codex --login`, or set `OPENAI_API_KEY`. |
