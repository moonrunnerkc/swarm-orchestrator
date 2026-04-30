# GitHub Action

Swarm Orchestrator includes a Docker action contract in [action.yml](../action.yml), with the runtime entrypoint in [entrypoint.sh](../entrypoint.sh).

Important current limitation: the Docker image in [Dockerfile](../Dockerfile) ships Node.js 20 and git, but it does not install `gh`, GitHub Copilot CLI, Claude Code, or Codex. Docker actions run in their own container, so installing an agent CLI in an earlier workflow step installs it on the runner, not inside the action container.

For live agent execution today, use the local CLI workflow below or build a custom action image that installs the selected agent CLI inside the image. The input contract remains documented here for maintainers and custom-image users.

## Local CLI workflow

This is the currently reliable GitHub Actions pattern for live agent execution. It builds `swarm-orchestrator` in the runner, installs the selected agent CLI in the same runner, then runs `node dist/src/cli.js`.

```yaml
name: AI Swarm
on:
  workflow_dispatch:
    inputs:
      goal:
        description: What should the swarm build or fix?
        required: true
      tool:
        description: CLI agent to use
        required: true
        default: codex
        type: choice
        options:
          - claude-code
          - codex

jobs:
  swarm:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Build Swarm Orchestrator
        run: |
          npm install
          npm run build

      - name: Install Claude Code
        if: inputs.tool == 'claude-code'
        run: npm install -g @anthropic-ai/claude-code

      - name: Install Codex
        if: inputs.tool == 'codex'
        run: npm install -g @openai/codex

      - name: Run Swarm Orchestrator
        run: |
          CMD=(node dist/src/cli.js run --goal "$GOAL" --tool "$TOOL" --pr review --yes)
          "${CMD[@]}"
        env:
          GOAL: ${{ inputs.goal }}
          TOOL: ${{ inputs.tool }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

Copilot CLI requires Node.js 22 or newer and an interactive `copilot` then `/login` flow. That flow is not practical on hosted GitHub Actions unless you provide a pre-authenticated custom runner or custom container.

## Docker action inputs

Exactly one of `goal`, `plan`, or `recipe` must be provided.

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `goal` | One of `goal`, `plan`, `recipe` | | Natural language goal. The entrypoint runs `swarm run --goal`. |
| `plan` | One of `goal`, `plan`, `recipe` | | Path to an existing plan file. The entrypoint runs `swarm swarm <plan>`. |
| `recipe` | One of `goal`, `plan`, `recipe` | | Built-in recipe name. The entrypoint runs `swarm use <recipe>`. |
| `tool` | No | `copilot` | CLI adapter: `copilot`, `claude-code`, `codex`, or `claude-code-teams`. |
| `model` | No | | Model override passed through as `--model`. |
| `max-retries` | No | `3` | Maximum retry attempts for queued and repair retries, passed through as `--max-retries`. |
| `pr` | No | `review` | PR mode, `auto` or `review`. |
| `sarif` | No | `false` | When `true`, runs `swarm gates . --sarif /tmp/swarm-gates.sarif` after the swarm command. |

The entrypoint also passes `--tool`, `--pr`, and `--max-retries` for `goal`, `plan`, and `recipe` modes.

## Outputs

| Output | Description |
| --- | --- |
| `result` | JSON summary from `/tmp/swarm-result.json` when the CLI writes it. |
| `plan-path` | Path to `/tmp/swarm-plan.json` when the CLI writes it. |
| `pr-url` | URL from `/tmp/swarm-pr-url.txt` when PR automation writes it. |
| `sarif-path` | Path to the generated SARIF file when `sarif=true`. |

### Result JSON shape

```json
{
  "allPassed": true,
  "totalSteps": 4,
  "completed": 4,
  "failed": 0,
  "totalDurationMs": 240000,
  "steps": [
    {
      "stepNumber": 1,
      "agentName": "worker",
      "status": "completed",
      "passed": true,
      "retryCount": 0
    }
  ]
}
```

## Agent auth

These install and auth strings apply to local CLI workflows and custom action images.

| Adapter | Install | Auth |
| --- | --- | --- |
| `copilot` | `npm install -g @github/copilot` | Run `copilot`, then `/login`. Requires Node.js 22 or newer. |
| `claude-code` | `npm install -g @anthropic-ai/claude-code` | Run `claude` for browser login, or set `ANTHROPIC_API_KEY`. |
| `claude-code-teams` | `npm install -g @anthropic-ai/claude-code` | Same auth as `claude-code`. Concurrency between steps is decided by the orchestrator's static dependency analyzer; there is no `--team-size` knob to pass through. |
| `codex` | `npm install -g @openai/codex` | Run `codex --login`, or set `OPENAI_API_KEY`. |

Never pass secrets through `with:` inputs. Use `env:` so GitHub masks repository secrets in logs.

```yaml
- name: Run Swarm Orchestrator
  run: node dist/src/cli.js run --goal "$GOAL" --tool codex --pr review --yes
  env:
    GOAL: ${{ inputs.goal }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## Exit codes

The entrypoint exits with the wrapped CLI command status.

The CLI returns nonzero when step verification fails. It can also report a nonzero CI result when final quality-gate statuses include failed findings, even though those gate findings are advisory and do not block branch merges.

## SARIF

When `sarif=true`, the entrypoint runs quality gates after the main command:

```bash
node /app/dist/src/cli.js gates . --sarif /tmp/swarm-gates.sarif
```

The gate command is allowed to fail without failing the entrypoint at that point, and the file path is written to the `sarif-path` output when the file exists. Uploading that SARIF to GitHub code scanning still requires a workflow step such as `github/codeql-action/upload-sarif`.

## Secret redaction

At the end of the Docker action entrypoint, known secret values are replaced in files under `/tmp` and `runs/` with tagged placeholders.

Redacted keys:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GITHUB_TOKEN`
- `COPILOT_TOKEN`
- `GOOGLE_APPLICATION_CREDENTIALS`

This redaction is best effort. It does not replace good secret hygiene in agent prompts and workflow logs.

## Maintainer checklist for making the Docker action live-agent ready

- Use a Node.js base image compatible with every bundled agent CLI. Copilot CLI currently needs Node.js 22 or newer.
- Install `gh` if `copilot` remains a supported Docker-action default.
- Install the agent CLIs inside the Docker image, or provide separate published images per adapter.
- Revisit the default `tool` input after the image contains the corresponding CLI and auth path.
- Add an integration workflow that runs at least one non-interactive API-key adapter in the action container.
