# Relaunch notes: Swarm Verify 1.3.1

Prepared material, not published posts. For the owner to publish from his own account, one
post per platform, after rechecking each platform's rules. Separate from the Swarm Orchestrator
relaunch in [relaunch-2026-10-08-swarm-orchestrator.md](relaunch-2026-10-08-swarm-orchestrator.md);
the two are not one announcement. Every statement below is backed by a record in this
repository at `swarm-verify@1.3.1`; nothing claims an advantage over another tool, because no
completed comparison supports one.

## The story

Independent verification for software changes from AI agents or humans.

1. An existing change or pull request, from Swarm Orchestrator, Claude Code, Codex, Copilot,
   another agent or a person.
2. The project's normal checks run unattended, in a fresh checkout of the base, in a
   network-disabled container under the Action.
3. The verifier assesses what was actually established: command execution, regression, task
   acceptance, challenge coverage, execution trust, integrity and signer identity, apart.
4. Unreliable or incomplete evidence is surfaced: a pass reported by an instrument the change
   edited reads incomplete with the files named; a failure the base already had reads
   inherited; a missing requirement contract leaves task acceptance `unmeasured`.
5. The evidence can be checked independently: every run exports a bundle with its own
   dependency-free verifier, and the Action's verdict is a GitHub artifact attestation.

## What changed in 1.3.1

- Swarm Verify has its own product home: [moonrunnerkc/swarm-verify](https://github.com/moonrunnerkc/swarm-verify)
  holds the GitHub Action, the Action reference, the example workflows, the changelog and the
  releases, every file generated from the source repository.
- The package README and metadata describe the verifier on its own terms and point at that
  home; the published package no longer describes the coding agent it shares an implementation
  with as an optional beta.
- The Action is branded Swarm Verify. No verification behaviour changed; the engine is 1.3.0's.

## Demo path

```sh
cd a-repository-with-tests && npm ci
npx swarm-verify                                  # the declared checks, run and assessed
npx swarm-verify ci --pr owner/repo#123           # a pull request, in a fresh checkout of its base
node <bundle>/verify.mjs <bundle>                 # the evidence, checked with nothing installed
```

The committed equivalents: [the tamper demo](../evidence/2026-09-27/verifier-first/tamper-demo-transcript.txt),
[the attack-control families](../verifier-first/attack-controls.md), and the installed-package
matrix on Linux, macOS and Windows recorded in [the completion index](../verifier-first/README.md).

## The limits, stated in the post

- A regression pass means no check failed because of the change, not that every check passed
  and not that the work was done.
- Neither a contract, a challenge nor a signature proves the code is semantically correct.
- Locally, commands run on the host under a built environment, a policy and not a sandbox.
- Known credential patterns are scrubbed from evidence; that is not secret removal.
- No completed comparison shows it catches more wrong work than another tool.

## Draft (dev.to, owner to edit)

**Title:** An agent says the work is done. Check what was actually measured.

Swarm Verify runs a project's own checks the way CI would and reports apart what passed, what
failed, what could not be trusted and what nobody measured. `npx swarm-verify` in a repository
with its dependencies installed is the whole setup; no model, no key, no configuration. As a
GitHub Action it verifies each pull request's head in a network-disabled container, signs the
verdict as a GitHub attestation, and posts one comment bound to the head. It works on a change
from any coding agent or any person.

What a green result means is narrow and stated: a regression-only pass says nothing broke. Only
a requirement contract can say the work was done, and the verifier says which of the two it is
reporting. Every run exports a bundle with its own verifier; change one byte and it is refused.

The coding agent built on the same verifier, Swarm Orchestrator, is a separate product with a
separate announcement.

Home: https://github.com/moonrunnerkc/swarm-verify. Source: https://github.com/moonrunnerkc/swarm-orchestrator
