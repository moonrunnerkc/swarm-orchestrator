# P0.5 Named-Session Stress Test Results

Date: 2026-04-26
Branch: `v7-overhaul`

## Scope

P0.5 validates whether a CLI can hold a long-running named session across checkpoints with acceptable resume latency and context retention. The guide requires Copilot CLI first, Codex fallback, and no Claude Code.

## CLI capability checks

### Copilot CLI

Command:

```bash
copilot --help
```

Relevant help output confirmed both required flags:

```text
-n, --name <name>                     Set a name for the new session
--resume[=value]                      Resume from a previous session
```

Version observed in the transcript:

```text
GitHub Copilot CLI 1.0.36.
```

### Codex CLI fallback

Commands:

```bash
codex --help
codex resume --help
codex exec --help
codex exec resume --help
```

Codex exposes resume by session id, thread name, or most recent session, but the inspected help output does not expose a new-session naming flag equivalent to Copilot `--name`. Because P0.5 requires named sessions, Codex was not a valid fallback for this test run.

## Harness

Script: `scripts/debug/session-stress-test.sh`

The harness was updated after the first interrupted run because it appeared to hang while it was actually waiting between checkpoints with no progress output. It now prints timestamped progress lines, records a summary on early exit, wraps each Copilot call with a checkpoint timeout, and exits as soon as a resume checkpoint exceeds the 5 second first-output latency threshold.

Run command:

```bash
scripts/debug/session-stress-test.sh stress-test-001-20260425T000000Z
```

Artifact directory, ignored by git:

```text
runs/session-stress-test/stress-test-001-20260425T000000Z/
```

Files produced before halt:

```text
checkpoint-1.out
checkpoint-1.first-ms
timings.tsv
transcript.md
workspace/
```

## Timing data

```tsv
checkpoint	started_at	ended_at	elapsed_ms	first_output_latency_ms	mode	probe
1	2026-04-26T04:16:18Z	2026-04-26T04:16:57Z	39558	17891	name	pass
2	2026-04-26T04:19:57Z	2026-04-26T04:20:57Z	59752	15600	resume	pass
```

## Criterion evaluation

| Criterion | Result | Evidence |
|---|---:|---|
| Session stays open for 20 minutes | Not evaluated | Halted after resume latency failed at checkpoint 2. |
| Context retention at every checkpoint | Partial pass | Checkpoints 1 and 2 both passed the probe. |
| Checkpoint 8 summary accuracy at least 80% | Not evaluated | Halted before checkpoint 8. |
| Per-resume overhead under 5 seconds | Fail | Checkpoint 2 first output latency was 15.600 seconds. |

## Decision

Copilot CLI failed P0.5 because named-session resume latency exceeded the 5 second threshold. Codex did not expose the required named-session creation flag in the inspected help output. P2 should use cold-start-per-step for these CLIs unless a later CLI version provides a faster named-session resume path.
