# Changelog

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

    npm install swarm-orchestrator@12.1.1

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
