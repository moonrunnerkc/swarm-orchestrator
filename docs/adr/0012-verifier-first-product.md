# 0012. The verifier is the product; the coding agent is an advanced beta mode

**Status:** approved 2026-09-27, implementation tracked in [docs/verifier-first/README.md](../verifier-first/README.md)

## Context

The front door presented three products of equal weight: a coding agent, a verification
path, and a research campaign. A person arriving with the ordinary question, "the agent says
the tests passed, did they?", had to choose among them before finding the one command that
answers it. The verification path already exists as its own package, `swarm-verify`, built from
the same modules the agent runs, with no provider, worker or screen module in its closure. It
is the part of the tree that is useful without a model account, without the agent and without a
campaign.

## Decision

`swarm-verify` is the primary product. Its job is stated in one sentence and is the only thing
the front door leads with: independently check what an AI-written change actually ran, whether
the available checks would detect relevant wrong work, and what remains unverified.

The coding agent stays in the tree, keeps every existing gate and safeguard, and is documented
as an advanced beta mode. It does not appear at the front door as a peer product, and it cannot
dictate the verifier's first run: installing or running the verifier initializes nothing of the
agent and requires none of its configuration.

Three consequences are decided here rather than left to drift:

1. **One engine.** The CLI, the GitHub Action, the editor hook, the MCP server and the
   pre-commit hook are thin clients of the same verifier engine and write the same evidence
   format. No second engine, no hand-edited distribution copy, no hosted dashboard, account
   system, database, billing service or orchestration daemon.
2. **Scope stated in the product.** Neither a signature nor a green test command proves a user
   requirement is satisfied. Every report separates command execution, check outcomes,
   execution trust, requirement coverage and challenge coverage, and says which of them were
   not measured. A regression-only pass renders as a regression-only pass.
3. **Model-driven work is opt-in.** Deterministic check challenges need no model key. Model
   proposals for additional checks and bounded implementation repair are explicit, capped and
   off by default; a key in the environment does not turn them on.

## What this replaces

The README of 14.2.0 led with the agent and listed verification third. The agent's own
requirements (a served model, an approval mode, a workspace manifest) were the first things a
new user met. ADR 0011 improved that first run for the agent; this record moves the agent off
the front door entirely.

## What it does not buy

A verifier-first front door does not make the verifier more capable than it is. The measured
scope of each release is recorded with that release, and the claims table in
[docs/claims.md](../claims.md) still governs what may be said. The comparative advantage of
challenging checks over ordinary CI is a hypothesis under test, tracked separately in the
verifier-first index, and this decision does not assume its result.
