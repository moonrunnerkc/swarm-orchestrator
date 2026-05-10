# Producer Adapter Capabilities

> **Scope.** This page documents the v6 *producer* adapters under
> `src/adapters/`: subprocess wrappers around third-party coding CLIs that
> generate patches in the verified-branch pipeline (`swarm run --v6`,
> `swarm swarm`, `swarm execute`). For the v8 *falsifier* adapter subsystem
> (Codex, Copilot, ClaudeCode falsifiers under `src/falsification/adapters/`),
> see [`falsification-adapters.md`](falsification-adapters.md).

Captured: 2026-04-26

P0.5 changed the P2 adapter plan. Copilot CLI named-session resume failed the 5s threshold with 15.600s first-output latency at checkpoint 2, and Codex did not expose a Copilot-equivalent named-session creation flag in the inspected help output. The orchestrator therefore does not use `--name` or `--resume` as its P2 execution model.

## Capability Matrix

| CLI | Cold-Start Per Step | Named Resume | Persistent Stdin/Stdout | Default P2 Mode | Notes |
|---|---:|---:|---:|---|---|
| Copilot CLI 1.0.36 | Yes | Failed P0.5, 15.600s resume latency | Supported by adapter, experimental | Cold-start fallback | Interactive command: `copilot --allow-all --no-ask-user --stream on`. End-of-turn is detected when stdout contains the orchestrator marker. |
| Claude Code | Yes | Not used for P0.5 budget reasons | Supported by adapter, experimental | Cold-start fallback | Interactive command: `claude --dangerously-skip-permissions`. Non-interactive `-p -` remains the stable cold path. |
| Codex CLI | Yes | Not valid for P0.5 named-session test | Supported by adapter, experimental | Cold-start fallback | Interactive command: `codex --dangerously-bypass-approvals-and-sandbox -C <dir> --no-alt-screen`. Non-interactive `codex exec` remains the stable cold path. |

## Execution Modes

`AgentAdapter.spawn()` accepts:

- `executionMode: "cold-start"`: run the existing one-process-per-step command.
- `executionMode: "persistent-interactive"`: require a persistent process, write the prompt to stdin, and wait for the stdout end marker.
- `executionMode: "auto"`: use persistent mode only when `SWARM_ENABLE_PERSISTENT_INTERACTIVE=1`; otherwise stay on cold-start fallback.

The orchestrator passes `auto` for step execution. This keeps CI and normal runs on the proven cold-start path while allowing persistent stdin/stdout sessions to be validated without another interface change.

## End-Of-Turn Contract

For each persistent turn, the adapter appends a unique marker instruction to the prompt:

```text
When this turn is fully complete, print this exact marker on its own line:
SWARM_TURN_DONE:<timestamp>:<counter>
```

The persistent session resolves the turn only after that marker appears on stdout. If the process exits, times out, or never prints the marker, the adapter marks the session unavailable and cold-start fallback remains the supported path.
