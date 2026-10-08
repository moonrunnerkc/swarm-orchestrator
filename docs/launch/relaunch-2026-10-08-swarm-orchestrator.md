# Relaunch notes: Swarm Orchestrator 14.4.0

Prepared material, not published posts. For the owner to publish from his own account, one
post per platform, after rechecking each platform's rules. Separate from the Swarm Verify
relaunch in [relaunch-2026-10-08-swarm-verify.md](relaunch-2026-10-08-swarm-verify.md); the two
are not one announcement. Every statement below is backed by a record in this repository at
`swarm-orchestrator@14.4.0`; nothing claims an advantage over another tool, because no
completed comparison supports one.

## The story

An AI coding agent whose work is controlled by independent gates and evidence rather than by
its own claims.

1. The agent receives a task and declares the files it intends to touch.
2. It changes the repository through one recording chokepoint.
3. The project's own checks run as gates sealed before the first model call; each passing
   gate is handed a fixture it must refuse.
4. Weak or failed evidence causes a retry under a ratchet that refuses a fix which trades away
   tests, assertions or coverage, or a refusal with the reason on the record.
5. A successful result produces a signed, hash-chained bundle that carries its own verifier,
   checkable on any machine with Node.

## What changed in 14.4.0

- The repository, package and README identify as Swarm Orchestrator, the coding agent. The
  14.3.0 front door, which presented Swarm Verify as this repository's product and the agent as
  a beta mode, is reversed ([ADR 0013](../adr/0013-two-products-one-verifier.md)).
- Swarm Verify, the verifier the agent is held to, has its own product home at
  [moonrunnerkc/swarm-verify](https://github.com/moonrunnerkc/swarm-verify), its own changelog,
  its own releases and its own GitHub Action identity.
- Nothing in the agent's runtime behaviour changed between 14.3.0 and 14.4.0; the verifier
  carried is 1.3.1, whose only changes are its identity and packaging.

## Demo path

```sh
npm install -g swarm-orchestrator
cd a-repository-with-tests
swarm "make slugify collapse whitespace and strip punctuation"
swarm review <bundle>           # the review page: tasks, gates, retries, the patch
node <bundle>/verify.mjs <bundle>   # the bundle's own verifier, anywhere
```

The committed equivalents: [a real run](../evidence/2026-08-18/live-tasks.md), [the packaged
tool against an unseen workspace](../evidence/2026-08-23/installed-package-run.md), and the
[tamper demo](../evidence/2026-08-18/tamper-demo).

## The limits, stated in the post

- Not production-ready; the open gates are in [beta-gates.md](../beta-gates.md).
- The default host mode is a policy, not a sandbox; `--isolation` asks for a container.
- A false-green rate of 0 in 15 says "under 20%", not "zero", for that corpus and that build.
- Gates prove mechanical quality, not design quality; review is faster, not unnecessary.

## Draft (dev.to, owner to edit)

**Title:** A coding agent that has to prove its work

Swarm Orchestrator is a coding agent for the terminal. Give it a task and a git repository and
it makes a bounded change, runs the project's real checks, and retries failures under a rule
that refuses a fix which deletes tests or assertions to get green. What it cannot do is declare
its own work done: a claim it makes is evaluated by the harness against records the harness
captured, a passing check is handed a fixture it must refuse, and the run ends in a signed,
hash-chained bundle that carries its own verifier. Change one byte of a record and the bundle's
own verifier refuses it with the broken link named.

The verification the agent is held to is a separate product, Swarm Verify, which checks a
change from any agent or person with no model; its relaunch is separate.

Limits, plainly: it is not production-ready, the default host mode is a policy and not a
sandbox, and a suite passing is not the task being done, which is why the report keeps
regression and task acceptance as two answers.

Source and evidence: https://github.com/moonrunnerkc/swarm-orchestrator
