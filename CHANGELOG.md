# Changelog

## 13.1.0

A run you can watch and drive, and an end-of-run panel that shows you what it produced.
Everything below is additive: no flag, command or output changed meaning, and the plain-line
stream a pipe or a CI job reads is byte-for-byte what it was.

### Added

- **An interactive terminal interface.** On a TTY, a run draws a single screen: the task and
  the model in a header, the plan, the action stream, the gate strip, and a status line.
  Scroll it, expand a row to the whole tool input and output and the ledger record it came
  from, filter it, freeze the render without touching the run, and press `?` for the keymap.
  Two exits that are not the same thing: `q` leaves the view and lets the run finish, `ctrl+c`
  cancels the run.
- **An end-of-run evidence panel.** What the run produced, named by what each artifact is for,
  with the record count and how many claims the harness verified against how many it refused.
  One keystroke opens the review page, another the bundle directory. It says the bundle
  verified only if the bundle's own verifier ran in that session and exited 0, and it names the
  exit code; otherwise it says "not verified in this run" and prints the command.
- **`swarm review <bundle directory>`**, which shows that same panel for any bundle already on
  disk, running the same verifier. Nothing is re-run.
- **`swarm --help`**, which used to report that `--help` needs a value.
- **Screen flags**: `--no-tui` for plain lines even on a terminal, `--color` and `--no-color`,
  `--open-evidence` and `--no-open-evidence`. Opening is opt-in and never happens off a
  terminal.
- **Three `swarm.toml` tables**: `[interface]` (`tui`, `color`, `open_evidence`), `[theme]`
  (a colour per slot), and `[keys]` (a key per action). Flags win over the file, as everything
  else does. An unknown key, colour or action is a typed error naming what was wrong and what
  would have been accepted.
- **Sampling settings on the wire for a calibration run**: temperature and top-p pinned and
  recorded in every model-call record, with a seed per repeat. An ordinary task run sends
  nothing and is unchanged.

### Fixed

- **Two consumers of one stdin.** The CLI built a readline interface on `process.stdin` while
  Ink held the same stdin in raw mode. A confirmation firing mid-run raced them, which is the
  least acceptable place to drop a keystroke. Confirmation is now a component inside the
  running screen, answered by the same key dispatcher.
- **The curated model shortlist and pricing table answered 404.** Both URLs named the branch
  `main`, which is the v12 lineage and carries neither file, so `swarm select` fell back to the
  bundled snapshot on every machine.
- **A missing verifier read as a refused bundle.** Node exits 1 on a module it cannot find,
  which at the exit code is the same as a verifier that ran and said no. One is the absence of
  a verdict.

## 13.0.0

Same package name, different product. If you installed `swarm-orchestrator` before this
release, read this before upgrading: v13 is not a newer v12, and nothing in v12's interface
survives.

### What v12 was, and what v13 is

v12 was a PR auditor. It ran as a GitHub Action, read pull requests opened by AI coding
agents, looked for cheat patterns (test relaxation, mock-of-hallucination, assertion strip,
no-op fix), posted findings as a comment, and gated merges.

v13 is a coding agent. It does the work rather than auditing somebody else's, and every
claim it makes about that work resolves to machine-captured evidence in a tamper-evident
ledger. The two share a name and nothing else: no shared history, no shared interface, no
migration path from one to the other, because there is nothing to migrate.

### Breaking

- **The `swarm-audit` and `swarm-orchestrator` binaries are gone.** One binary now, `swarm`.
- **The GitHub Action is retired.** v13 ships no `action.yml`. There is no v13 equivalent of
  the merge gate, and none is planned.
- **Node 24 or newer.** v12 asked for 20. The floor is not stylistic: the coverage cycle
  spawns the test runner with `--test-isolation=process`, which Node 22 rejects as a bad
  option, so on anything older that arm measures nothing.
- **The histories share no merge base.** v13 is a separate lineage. `git log` will not show
  you v12's commits from here.

### If you are using v12

Stay on it. It is tagged `v12-final` and that tag is not going away.

    npm install swarm-orchestrator@12.0.0

That is the newest v12 the registry carries. The `v12-final` tag is at 12.1.1, which was
tagged but never published, so `@12.1.1` does not resolve; install from the tag if you need
exactly that tree.

For the Action, pin the tag rather than a branch, since the default branch is moving to the
v13 lineage:

    uses: moonrunnerkc/swarm-orchestrator@v12-final

### What v13 does

One task, start to finish, in a git workspace: plan, edit through a chokepoint that records
every tool call, run the gates, auto-resolve failures under a numeric ratchet, and export a
signed evidence bundle a stranger can verify without installing anything.

The parts worth knowing before you try it:

- Gate results, claim verdicts and bundle status are computed by the harness. Model prose
  renders as unverified narrative and cannot render green.
- The ledger is append-only and hash-chained, signed with a key from the OS keychain.
- The bundle carries its own verifier. `node verify.mjs <bundle>` needs Node and nothing
  else.
- Local model selection is measured on your hardware rather than guessed from model cards.

`README.md` links each of those to a committed artifact of it happening. `docs/claims.md`
maps every claim to its evidence, and lists what this tree cannot back.
