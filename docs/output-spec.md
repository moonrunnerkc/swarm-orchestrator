# CLI output spec

The target shape for `swarm run`, `swarm swarm`, `swarm bootstrap`, and `swarm quick` terminal output. Reference points: cargo, pnpm, vercel, bun. Quiet by default, structured, color used purposefully, progress that updates in place rather than scrolls, debug data hidden behind `--verbose`.

The current state, captured in `/tmp/output-before.txt` and audited in `/tmp/output-before-categorization.md`, is the baseline this spec replaces.

## Channels

| Channel | What flows through it | When visible |
|---|---|---|
| `stdout` | Presenter output (banners, summary blocks, live step status, results, footer). One coherent visual surface for the user. | Always, except `--quiet` (suppresses everything except errors and the final one-line result). |
| `stderr` | Logger output: `error`, `warn`, plus `info`/`debug`/`trace` when `--verbose` is on. Diagnostic only. | `error`/`warn` always. `info`/`debug`/`trace` only with `--verbose`. |
| `runs/<id>/run.log` | Full trace of every logger call (level, scope, message, timestamp). Written regardless of verbosity. | Always written. The user reads it via `swarm report --latest --logs` or by opening the file. |
| `runs/<id>/steps/step-N/share.md` | Agent transcripts. Existing artifact, unchanged by this work. | Always written. |

The split is: **stdout is for users, stderr is for developers, run.log is for forensics.** Today these are all conflated on stdout under the same `[scope]` prefixes.

### Verbosity flags

- default (no flag) — info-level user surface on stdout via presenter; warnings on stderr; nothing else.
- `--verbose` — also stream debug-level diagnostic logs to stderr with `[scope]` prefix. Equivalent to `LOG_LEVEL=debug`.
- `--quiet` — suppress presenter output, suppress info/debug. Errors and the final one-line result still go to stdout. Suitable for scripting.
- `--json` — already supported. JSON-shaped event stream on stdout, no presenter, no ANSI.

`LOG_LEVEL` env var overrides the flag: `LOG_LEVEL=trace` enables trace-level (file-only today; surfaces on stderr if explicitly set).

### Log levels

| Level | Used for | Where it goes by default | With `--verbose` |
|---|---|---|---|
| `error` | Unrecoverable failures, abort reasons. | stderr | stderr |
| `warn` | Recoverable issues the user should know about. | stderr | stderr |
| `info` | Diagnostic info (run id, exec id, scaffolding). **Not** user-facing surface; that's the presenter. | suppressed | stderr |
| `debug` | Module internals, decisions, dispatch traces. | suppressed | stderr |
| `trace` | High-volume per-call detail (test command discovery, env loading, every git invocation). | suppressed | run.log only unless `LOG_LEVEL=trace` |

The new level is `trace`. Today the logger has 4 levels; we add a fifth at the bottom and reclassify the `[prompt-builder] test command discovery` lines and similar high-volume scaffolding into it.

## Visual hierarchy

Mocked exact bytes for each state. ANSI is shown as `<dim>...</dim>`, `<green>...</green>`, etc. ASCII glyphs in parens after each unicode glyph note the fallback when `LANG`/`LC_*` indicate non-utf8 or `SWARM_ASCII=1` is set.

### State: planning

```
swarm run
<dim>·</dim> Add a function called greet that returns 'hello world' in a new file called greet.js

  <dim>plan</dim>     1 step <dim>·</dim> claude-sonnet-4 1×
  <dim>cost</dim>     1–3 premium requests <dim>·</dim> 15% retry buffer
  <dim>target</dim>   /tmp/swarm-baseline-repo
```

No banner. No emoji. The first thing is the goal echoed under a sigil (`·`). Then a left-aligned key/value summary block. Mirrors `cargo build`'s startup surface.

### State: awaiting confirmation

```
  Continue? [y/N] <cursor>
```

One line. Default-no. `--yes` skips entirely.

### State: executing (TTY)

The plan/cost block stays. Below it, a live block re-renders in place. Each running step is one line.

```
  <dim>plan</dim>     2 steps <dim>·</dim> wave 1 of 1
  <dim>cost</dim>     2–6 premium requests
  <dim>target</dim>   /tmp/swarm-baseline-repo

  <cyan>⠋</cyan> step-1 worker <dim>12s · editing greet.js</dim>
  <cyan>⠋</cyan> step-2 reviewer <dim>3s · synthesizing tests</dim>
```

The two step lines re-render every 100ms (current `LiveStatus` interval). When a step finishes, the live block reduces by one line and a static line is printed above:

```
  <dim>plan</dim>     2 steps <dim>·</dim> wave 1 of 1
  <dim>cost</dim>     2–6 premium requests
  <dim>target</dim>   /tmp/swarm-baseline-repo

  <green>✓</green> step-2 reviewer <dim>14s · verified</dim>
  <cyan>⠋</cyan> step-1 worker <dim>22s · running tests</dim>
```

Glyph fallback when not utf8: `*` for spinner, `v` for `✓`, `x` for `✗`, `!` for `!`, `.` for `·`.

### State: executing (non-TTY)

No in-place updates. Each transition prints one line at info level via the presenter (the existing `LiveStatus` non-TTY branch already does this):

```
  · step-1 worker started
  · step-2 reviewer started
  v step-2 reviewer 14s · verified
  v step-1 worker 22s · verified
```

Captured logs are appended once per transition. CI pipes get exactly this shape. Today's capture has the same shape; the change is removing the `[scope]` prefixed scaffolding around it.

### State: gate-running

Single in-place line, replaces the step block once all steps merge:

```
  <cyan>⠋</cyan> running quality gates <dim>· 3 of 9</dim>
```

### State: complete

Static block. Replaces all live content. Scrolls.

```
  <green>✓</green> <bold>done</bold> <dim>·</dim> 1/1 step <dim>·</dim> 59s <dim>·</dim> 1 premium request <dim>·</dim> 8 gates passed
  <dim>artifacts</dim> /tmp/swarm-baseline-repo/runs/swarm-2026-04-30T02-16-52-061Z
```

If a PR was created, one line per PR:

```
  <dim>pr step-1</dim> https://github.com/owner/repo/pull/123
```

If gates failed, one line per fail:

```
  <green>✓</green> <bold>done</bold> <dim>·</dim> 1/1 step <dim>·</dim> 59s <dim>·</dim> 8 gates passed <dim>·</dim> 1 failed
  <dim>·</dim> hardcoded-config <dim>· 2 findings (advisory)</dim>
  <dim>artifacts</dim> /tmp/swarm-baseline-repo/runs/swarm-2026-04-30T02-16-52-061Z
```

### State: failed

```
  <red>✗</red> <bold>1 failed</bold> <dim>·</dim> 0/1 step <dim>·</dim> 41s <dim>·</dim> 0 premium requests
  <red>✗</red> step-1 worker <dim>copilot</dim> <dim>·</dim> verification failed: tests not run
  <dim>inspect: swarm report swarm-2026-04-30T02-16-52-061Z</dim>
  <dim>artifacts</dim> /tmp/swarm-baseline-repo/runs/swarm-2026-04-30T02-16-52-061Z
```

### State: governance pause

```
  <yellow>!</yellow> <bold>paused</bold> <dim>·</dim> rate limit hit on step-2
  <dim>resume:</dim> swarm swarm <plan> --resume swarm-2026-04-30T02-16-52-061Z
```

## Progress indication

In TTY: the existing `LiveStatus` (`src/cli/live-status.ts`) is the substrate. It already pins a live block to the bottom and re-renders in place at 100 ms. Confirmation that:

- Banner / plan summary / cost block are printed once with `LiveStatus.print()` so they scroll above the live block correctly.
- Step started/finished transitions go through `addStep` / `finishStep`.
- Mid-step actions go through `setAction` (already wired from `step-executor.ts:308,368`).

The presenter does not own progress; it owns the static surfaces (banner, summary, footer). Progress stays with `LiveStatus`.

In non-TTY: each step lifecycle gets one info line. No spinner. No cursor moves. ANSI escapes are entirely suppressed.

## Color and symbols policy

| Color | Meaning |
|---|---|
| green | success (`✓`, `done`) |
| red | failure (`✗`, `failed`) |
| yellow | warning, paused |
| cyan | active/in-progress (spinner) |
| dim | secondary (paths, ids, durations, counts, separators) |
| bold | the headline word in the final summary (`done`, `failed`, `paused`) |

Color is suppressed entirely when:
- `process.env.NO_COLOR` is set (any value).
- `process.env.CI` is set (treated as non-interactive).
- `process.stdout.isTTY` is false.

Glyph degradation: if `LANG`/`LC_ALL`/`LC_CTYPE` do not contain `UTF` (case-insensitive), or if `SWARM_ASCII=1` is set, replace utf8 glyphs with ASCII per the table in the executing-TTY section.

| Glyph | utf8 | ASCII |
|---|---|---|
| spinner | `⠋⠙⠹...` | `*` |
| success | `✓` | `v` |
| failure | `✗` | `x` |
| warning | `!` | `!` |
| separator | `·` | `.` |
| sigil | `·` | `.` |

## Agent narration

Default behavior changes from today.

- Today: every line of agent narration (`step-N › ...`) prints to stdout as it streams. 50+ lines for a one-step plan.
- Target default: collapsed to one live action line per step (`<spinner> step-N worker · editing greet.js`), driven by parsing the agent stream for activity markers (the `●` lines that today render as `step-N › ● ...`). Full transcript continues to land in `runs/<id>/steps/step-N/share.md`, unchanged.
- `--stream-agent` opt-in flag: prints the full firehose to stdout interleaved with the live block. This is the only way to get current behavior back.
- `--verbose` does NOT enable `--stream-agent`. They are independent. `--verbose` is for orchestrator diagnostics; `--stream-agent` is for agent narration.

This is the single biggest signal-to-noise win in the spec. Most users do not read agent narration in real time; they read the transcript after the fact when something went wrong.

## What survives in the artifacts directory

Everything that was visible on stdout today and is hidden by this spec must remain available in `runs/<id>/`:

- Full agent transcript: `steps/step-N/share.md` (already written today).
- Full diagnostic log: `run.log` (new). Receives every `info`/`debug`/`trace` call regardless of verbosity, with timestamps and scope. This replaces the developer-facing portion of stdout.
- Per-step verification report: `verification/step-N-verification.md` (already written).
- Quality gate report: `quality-gates/quality-gates.md` and `.json` (already written).
- Metrics: `metrics.json` (already written).

If a user complains "I can't see X anymore", the answer is one of: `--verbose`, `--stream-agent`, or `cat runs/<id>/run.log`. The information is not deleted; it moves out of the default scrolling surface.

## What this spec does not change

- The dashboard at `swarm dashboard` (if/when it ships) is a separate Ink-based surface. It does not consume the presenter; it has its own UI tree.
- JSON output (`--json`) emits structured events on stdout, ignores the presenter, and is unchanged in shape.
- The CI output files (`/tmp/swarm-result.json`, `/tmp/swarm-plan.json`, `/tmp/swarm-pr-url.txt`) are unchanged.
- Quality-gate scoring, verification, merge logic. Output only.

## Out of scope (explicitly)

- A full event-bus refactor where the orchestrator emits typed events and the presenter is the only stdout consumer. Today the orchestrator emits a mix of logger calls and direct `LiveStatus` calls. The pragmatic v1 wraps the user-facing logger.info call sites in presenter methods. A second-pass refactor can collapse those into typed events. The spec is forward-compatible with that refactor.
- Multi-pane TUI layout. The presenter is line-oriented and scrolls.
- Replacing `LiveStatus` with a different rendering library. It already does what we need.
