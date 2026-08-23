# The interactive terminal interface

What the screen shows, what the keys do, what config changes, and how it degrades. Every
frame quoted here was lifted from a real pty capture rather than typed out:
`interface-frames.txt` holds them in full and `interface.cast` is a playable recording of one
session.

## What is on the screen

Five bands, in this order, and each one is a projection of what the harness reported:

| Band | What it holds |
| --- | --- |
| Header | the task, and on a wide enough window the model, the workspace, elapsed time, the step count, tokens, the attempt counter, and the ratchet tally |
| Plan | the planner's own text, up to three rows |
| Actions | one row per tool call, tool outcome, model error and ratchet decision, newest last |
| Detail | the whole payload of the selected row, when a row is expanded, and the ledger record it was written from |
| Gates | the latest result per gate, with a word as well as a colour, and the attempt counter |
| Status | where the run is, and whether it finished, escalated or is still going |
| Hint bar | the keys, or the filter box while one is being typed |

```
swarm  make the parser trim before it splits
  local:qwen3-coder:30b-a3b  /Users/brad/projects/scratch-repo  20s  step 4  5812 tokens  attempt 1/3
plan
  read the failing test, fix the parser, run the gates
actions
  read path=src/parse.ts
  read ok: export function parse(text) { return text.split(',') }
  edit path=src/parse.ts find=text.split replace=text.trim().split
  edit ok: 1 edit applied
  shell command=npm test
  shell failed: 1 failing
  ratchet accepted: tests collected 12 to 12, assertions 34 to 35, skips 0 to 0
gates  attempt 1/3
  PASS tests: 12 collected, 0 failed
  PASS lint: no findings in 208 files
  PASS typecheck: no diagnostics
  N/A  coverage: no lcov artifact was written to the path the harness named
  WARN diff-budget (advisory): 1 file changed, 1 line added, budget 12 files and 400 lines
DONE stopped: completed (4 steps, 5812 tokens)
j scroll  enter expand  tab pane  / filter  e evidence  ? help  q detach  ctrl+c cancel run
```

There is no progress bar and there is no percentage. An agent run has no denominator, so what
the header carries is elapsed time, the step count, the attempt counter and the ratchet tally,
each of which is a number the harness reported. The token count reads "tokens at the end"
until the stop event carries one, because a zero would read as a measurement.

## The keymap

| Key | What it does |
| --- | --- |
| `j`, `down` | scroll down one row |
| `k`, `up` | scroll up one row |
| `ctrl+d`, `pagedown` | scroll down one page |
| `ctrl+u`, `pageup` | scroll up one page |
| `g` | jump to the oldest row |
| `G` | follow the newest row |
| `enter` | expand or collapse the selected row |
| `tab` | move focus between the action stream and the gates |
| `/` | filter the action stream |
| `p` | freeze the screen, which does not touch the run |
| `?` | the help overlay |
| `e` | show what this run produced |
| `o` | open the review page (evidence panel only) |
| `b` | open the bundle directory (evidence panel only) |
| `q` | leave the view, run keeps going |
| `ctrl+c` | cancel the run |
| `y` / `n` | answer the call being asked about |
| `escape` | close the overlay, or clear the filter |

Two exits, and they are not the same thing. `q` detaches: the view goes away and the run
carries on to its gates and its bundle. `ctrl+c` cancels the run itself. Conflating them
loses somebody's work, so they are separate keys and the hint bar names both.

Three modes take the keyboard away from that map, and `src/tui/key-dispatcher.test.ts` tables
all of them:

- While a confirmation is waiting, only `y`, `n`, `escape` and `ctrl+c` do anything. Scrolling
  away from the question is not an answer.
- While the filter box is open, every printable key types into it, so a filter can contain a
  `p` without pausing the screen.
- `o` and `b` do nothing until the evidence panel is up, because there is no bundle to open
  before one has been written.

`ctrl+c` is the exception to all three: it works from every mode, because it is the key a
person reaches for when the screen is doing something they did not expect.

## Confirmation, and the stdin collision it used to cause

`cli.ts` built a readline interface on `process.stdin` and also rendered an Ink app, which
holds the same stdin in raw mode. Two consumers of one stream is a correctness problem, and it
showed up exactly at the provenance-confirmation path from invariant 5, which is the least
acceptable place to drop a keystroke.

There is now one owner of stdin per process. On the interactive path the confirmation is a
component inside the running screen, rendered from the same store and answered by the same key
dispatcher; readline is used only where Ink is not running, which is `--no-tui` on a terminal.
Off a terminal the call is refused and recorded, exactly as before.
`src/tui/confirmation-path.test.ts` drives a keystroke through the dispatcher, into the queue,
and out of the chokepoint's own prompt, in both directions, and asserts the tool ran or did not.

## The evidence panel

When a run finishes, succeeds, escalates or is cancelled, the screen becomes this:

```
what this run produced

  the page a person reads: /Users/brad/.swarm/sessions/drive-demo/bundle/review.html
  the bundle a stranger verifies: /Users/brad/.swarm/sessions/drive-demo/bundle
  its own verifier, needing nothing installed: node .../bundle/verify.mjs .../bundle
  the chain every record is on: /Users/brad/.swarm/sessions/drive-demo/bundle/ledger.jsonl

  47 records. The harness verified 2 claim(s) and refused 5.
  bundle verified in this run: verify.mjs exited 0
o open review page  b open bundle  escape back  q detach
```

Four rules hold it honest:

1. **Opening a file is not verifying it.** The panel says verified only where the bundle's own
   embedded verifier ran in this session and exited zero, and it names the exit code. Otherwise
   it says "not verified in this run" and prints the command.
2. **Opening is opt-in and never the default.** Nothing opens unless a key is pressed, or
   `--open-evidence` was passed, and nothing ever opens off a terminal.
3. **Open by argv, never by shell.** `open`, `xdg-open` or `explorer.exe` is spawned as an
   argument vector with the path as its own argument, under an environment the harness built
   rather than inherited: no `NODE_OPTIONS`, no `LD_PRELOAD`, nothing that decides what a
   process loads. Windows uses `explorer.exe` rather than `start`, which is a cmd.exe builtin
   and would put a shell in between.
4. **Only a harness-computed path.** The bundle directory comes from the session. A path tagged
   `model`, `tool-output`, `file` or `user` raises a typed error rather than being opened.

`swarm review <bundle directory>` shows the same panel for any bundle already on disk, running
the same verifier, so there is one implementation of this and not two.

## The config surface

Everything lives in `swarm.toml`, which was already the one optional config file, and every
value is validated at the boundary with an error that names the key and the accepted set.

```toml
[interface]
tui = true            # false is --no-tui: plain lines even on a terminal
color = "auto"        # "auto" | "always" | "never"
open_evidence = "ask" # "ask" | "always" | "never"

[theme]
accent = "cyan"
passed = "green"
failed = "red"
advisory = "yellow"
inactive = "gray"
muted = "gray"
selected = "blue"

[keys]
pause = "space"       # any action from the keymap above, bound to any key
detach = "x"
```

Defaults: `tui = true`, `color = "auto"`, `open_evidence = "ask"`, the palette above, and the
default keymap. One theme ships, not six; the `[theme]` table is how it gets changed.

A rebinding replaces that action's keys rather than adding to them, so the old key stops doing
the old thing. `"space"` and a literal space are the same key. An unknown action name, an
unknown colour slot, an unknown colour, or an empty binding is a typed error naming what was
wrong and what would have been accepted.

Flags, for the people who script it: `--no-tui`, `--color`, `--no-color`, `--open-evidence`,
`--no-open-evidence`. Precedence is the one everything else in this tool uses, flags over the
environment over `swarm.toml` over the default. Colour under `auto` is the single place the
environment gets a say, because `NO_COLOR` is a convention a person sets once for every tool
rather than for this one.

## Degradation

| Condition | What happens |
| --- | --- |
| TTY, interactive | the screen above |
| Not a TTY | the plain line stream, byte for byte what it was before this work, held to a committed fixture by `src/tui/plain-lines.test.ts` |
| `--no-tui` on a TTY | the same plain line stream, with readline answering confirmations since Ink is not holding stdin |
| `NO_COLOR` set | the same screen with no colour at all and no escape sequence in any row; every status still carries `PASS`, `FAIL`, `N/A` or `WARN` |
| `TERM=dumb` | the same as `NO_COLOR` |
| `TERM` unset | the same as `NO_COLOR` |
| Below 80 columns | the header detail line and the gate detail text come off, the hint bar shows keys without their words, and nothing wraps |
| Window resized | `SIGWINCH` re-lays out; every row is truncated to the new width on the character, never the byte |
| Fewer rows than the panes need | panes come off in priority order, and the layout never paints more rows than the window has |

At 68 columns, from the capture:

```
swarm  make the parser trim before it splits
plan
  read the failing test, fix the parser, run the gates
actions
  read path=src/parse.ts
  read ok: export function parse(text) { return text.split(',') }
  edit path=src/parse.ts find=text.split replace=text.trim().split
  edit ok: 1 edit applied
  shell command=npm test
  shell failed: 1 failing
  ratchet accepted: tests collected 12 to 12, assertions 34 to 3...
gates  attempt 1/3
  PASS tests
  PASS lint
  PASS typecheck
  N/A  coverage
  WARN diff-budget (advisory)
DONE stopped: completed (4 steps, 5812 tokens)
j enter tab / e ? q ctrl+c
```

## What a payload cannot do to the screen

Tool output reaches the action stream, so a payload carrying cursor control would move the
cursor rather than be read. Every string reaching a cell goes through
`stripControlCharacters` first, which replaces each C0, DEL and C1 character with one visible
cell, so the escape sequence is shown as text and the row keeps the width it was measured at.
Widths are counted in terminal cells over grapheme clusters, so a CJK path counts two cells per
character and an astral character counts one rather than two, and truncation cuts on a grapheme
boundary rather than splitting a surrogate pair.

## What holds invariant 1 here

`SessionView` is the projection of what the harness reported and is the only thing a gate
verdict is read off. `ViewState` is what the person watching has done: focus, scroll, filter,
expansion, pause. They are separate types with separate reducers, and `view-state.test.ts`
asserts across every action that no `ViewState` field shares a name with a `SessionView` field
and that no value any action can produce reads as a verdict. A keystroke has no route to green.

## The recording

`interface.cast` is an asciinema v2 recording of one session, 100 by 32, captured from a real
pty. It plays with `asciinema play docs/evidence/2026-08-23/interface.cast`, and asciinema
3.2.1 parses and converts it, which is the check that was run here rather than a claim that it
looks right.

`interface-frames.txt` holds nine frames lifted from four captures, escape sequences stripped:
mid-run, an expanded action, an expanded ratchet row with its record digest, the help overlay,
the filtered stream, the evidence panel, 68 columns, `NO_COLOR`, and `TERM=dumb`.

The session those recordings show is driven by a fixed event sequence rather than a live model,
so it renders the same thing every time. What it does not show is a model producing those
events; that is what the live-task evidence beside it is for.
