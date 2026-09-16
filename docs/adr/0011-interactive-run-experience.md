# 0011. A run that says what it is doing, picks a served model, and asks once about approval

**Status:** approved 2026-09-16, implementation tracked in the commits that cite this file

## Context

Two first-time runs on 2026-09-16 showed what a person meets today. A task in an empty
directory ran for 1h 35m and escalated; the fixes for that are in ADR-free commits of the same
day (`ebb7fb42c`). The run that went green still asked the person to answer three confirmation
prompts, every one for a program off the shell allowlist (`pip`), with no way to say "always"
and no way to choose an approval mode up front. The model it used was found through a
calibration that exists on that machine; a fresh machine with Ollama running and no key set
gets the default `anthropic:claude-opus-5` and then "no usable model", although `swarm select`
already probes the hardware and knows the shortlist. And the screen, which is correct and
tested at four widths, reads as a log: one activity line, a gate list, and an end panel that
prints paths a person has to copy.

Three decisions follow, each bounded by an invariant it must not weaken.

## Decision 1: approval mode, asked once, with a per-program allowance

Confirmations come from two guards (invariant 3 and invariant 5): a program not on the shell
allowlist, and the derivation heuristic, which is the injection defence. They are treated
differently.

- A setting `[tools] approval = "ask" | "auto"` in `swarm.toml`, a flag `--approve auto|ask`,
  and `SWARM_APPROVAL`, with the precedence every other setting has. Default `ask`.
- The first run on a terminal in a workspace whose `swarm.toml` has no `approval` asks once,
  "Approve off-allowlist commands automatically in this workspace?", and writes the answer into
  `swarm.toml`, creating the file if there is none. Off a terminal nothing is asked and `ask`
  stands, which off a terminal means every prompt is refused, as today.
- In `auto`, a `shell-allowlist` prompt is answered yes by the harness before any person sees
  it, and the chokepoint records the confirmation with `decision: "pre-approved"` and the mode
  that decided it. A `derivation-heuristic` prompt is never pre-approved: it asks, on any mode,
  because a command that looks copied from untrusted content is exactly what the heuristic
  exists to stop, and a mode that switched it off would be a mode that switched off invariant 5.
- Every prompt gains a third answer beside yes and no: `a`, always allow this program for the
  rest of this run. The chokepoint keeps a run-scoped set of allowed programs, records each
  addition as a `run-allowance` record with user provenance, and consults the set before
  raising `shell-allowlist` again. It is run-scoped by design: it dies with the process and
  never reaches `swarm.toml`, so a yes given under pressure at step 12 does not become policy.
- The screen's header shows the mode; the plain-line stream prints it once at the start.

What this does not buy: `auto` is not a sandbox and does not change what the guard is, a
lexical path and program policy. A pre-approved `pip install` runs whatever the registry
serves. The bundle names the mode and every pre-approval, so a reviewer can see what nobody
was asked about.

## Decision 2: the model default is the best served local model for this hardware

When nothing pins a model and no calibration pick exists, the run:

1. discovers the local backends (Ollama, rapid-mlx) and asks each what it serves;
2. probes the hardware and loads the shortlist, exactly as `swarm select` does;
3. keeps only served models the shortlist names, ranks them by the shortlist's tier for this
   hardware and then by the shortlist's own order within the tier, and picks the top one;
4. where no served model is on the shortlist, picks the first served model on the preferred
   backend and says that it is unranked;
5. where nothing local is served, uses the first frontier provider whose key is set, in the
   existing fallback order; where none is set, the existing "no usable model" error stands.

The choice is printed before the session opens ("model: local:qwen3.6:35b-a3b, the highest
shortlist tier served here for 64 GB") and recorded as a routing decision with a new
assignment kind, `hardware`. This is not learned routing (invariant 14 and the build guide's
routing section): it consults no reward and no held-out evidence, and a calibration pick or a
pinned model still wins over it. `--model`, `SWARM_MODEL` and `[models] pin` are unchanged.

## Decision 3: the screen

The architecture stays: `session-view.ts` is the only projection, `screen-model.ts` turns it
into rows, `screen.ts` maps a row to one Ink `Text`, and `view-state.ts` shares no field with
the projection. What changes is what the rows say.

- A preflight card, printed on stderr before the screen and once in the plain-line stream:
  repository and base commit, manifest found, model chosen and why, approval mode.
- A header card of two lines: the task; then workspace, elapsed, step, tokens, attempt,
  ratchet and model, with the approval mode.
- The plan, as today.
- A timeline: each action with a status glyph (done, failed, pending, in progress), the tool
  and its summary, and the elapsed time since the previous action. Glyphs fall back to ASCII
  where the locale is not UTF-8.
- A gate strip with counts (passed, failed, not applicable) and a badge per gate.
- The live activity line with the spinner, as today, and the hint bar.
- A finish card: the verdict word, duration, steps, tokens, cost, record count, claims
  verified and refused, whether the bundle verified here, then the review page and the bundle
  as links. Where the terminal supports OSC 8 hyperlinks (iTerm2, VS Code, WezTerm, kitty,
  Ghostty, Windows Terminal, Hyper, detected from the environment and never assumed), the path
  is wrapped as a `file://` link the person clicks; elsewhere it is the plain path. The `o` and
  `b` keys stay. The link wrapper is applied to a row after its content has been neutralised,
  so tool output still cannot carry a control sequence to the terminal (the hazard
  `terminal-text.ts` exists for).
- The plain-line stream a pipe or CI reads is unchanged and stays held to its committed
  fixture, byte for byte.

## Testing

Each decision lands with tests that fail first: the approval precedence and the once-asked
write; the chokepoint pre-approving an allowlist prompt and never a derivation prompt, and the
run allowance consulted before the guard; the ranking over served models against the
shortlist with the hardware probe injected; the rows at 60, 80, 120 and 200 columns and every
height from one row up, the link wrapping under a supporting and a non-supporting environment,
and the plain-line fixture unchanged.
