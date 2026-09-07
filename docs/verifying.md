# Verifying work, yours or somebody else's

Every gate a run executes runs in the workspace that run was editing, with the tests that run may
have changed, reading reports that run's own processes wrote. The sealed criteria and the ratchet
close most of that. What they cannot close is the shape of it: a subject grading its own paper.

`swarm ci` is the separate opinion, and it does not need this tool's agent to have produced the
patch.

```sh
swarm ci --patch candidate.diff --install --oracle "npx jest tests/the-task.test.ts"
```

It clones the base commit into a fresh checkout, applies the patch there, and runs the checks in
that checkout, with the gates assembled from the base commit's manifests rather than the patched
tree's, so a patch that rewrites the test script does not get to choose the instrument that
measures it. A patch touching a path you declared immutable is refused before anything runs. A
patch that will not apply reports that no check happened rather than passing on an unchanged tree.

## Two answers, not one

```
regression: pass   task: unjudged
```

`regression` is whether the repository's own suite still passes: it says nothing broke.

`task` is whether the work was actually done, and only an oracle can say that, because a suite
tests the behaviour a project already had and a task adds behaviour it did not. A patch that adds
a feature badly still passes a suite written before the feature existed.

**Measured:** four of eighteen real-repository patches passed their project's whole suite and
failed a hidden acceptance test. That is a 22% false-green rate, and it existed until the two
answers were separated. `--oracle <command>` supplies the second; without it the task is
`unjudged` and nothing is verified, which is the honest answer rather than a pass by omission.

## A failure the base already had is not a regression

A check that fails with the patch is re-run with the patch reverted, on the same checkout, so the
two runs differ in the patch and nothing else. One that fails both ways is recorded as inherited
and does not make `regression` fail.

This is not hypothetical. Dependencies install with `--ignore-scripts`, because install scripts
run whatever the registry serves, so a project that builds on `prepare` is verified without its
build output. koa routes `import 'koa'` to `./dist/koa.mjs`: 437 tests passed and 2 failed without
the build, 439 and 0 with it, and those two were being charged to the patch.

## Installing dependencies

`--install` installs the fresh checkout's dependencies from its lockfile, with install scripts
off. It is not the default, because installing runs whatever the registry serves.

Without it a real project has no test runner in the checkout and every check stands down, which is
reported as `not measured` rather than as a refusal. Those are different findings, and the
difference is the point of this tool.

## Reading another agent's stream

Pass `--agent-stream` with `--agent-format claude-code` or `generic` and another agent's own event
stream is read beside the patch. A line the adapter does not recognise refuses the whole stream by
line number rather than being skipped, because a skipped line is evidence that quietly went unread.

## What a run reports

Nine answers, not one:

```
verdict:
  integrity       valid
  signer          untrusted
                  no expected signer was matched, so the signature shows the bundle is
                  unchanged since it was written and not who wrote it
  executionTrust  restricted
                  commands ran under a lexical path and program policy, which is not containment
  policy          pass
  mechanical      pass
                  lint passed
  behavioral      unmeasured
                  no dynamic gate ran, so nothing executed the change (tests stood down)
  semantic        unmeasured
  task            unjudged
  humanApproval   not-required

acceptable: no
```

`unmeasured` is a value, not a missing one. A change whose only passing gate was a linter is not a
change anything ran: linting proves the source parses and establishes nothing about whether any of
it was executed.

`semantic` abstains by construction, because judging whether a change means what the task asked
for is a judgement about meaning, and nothing here is allowed to make one.

`acceptable` means no blocking gate failed, no policy gate failed, and something executed the
change. It does not mean the change is right.

## Checking a bundle without this tool

Every bundle carries its own verifier, and it is dependency-free by design:

```sh
node verify.mjs .        # from inside a bundle directory
node rederive.mjs .      # re-derive every verdict from the records
```

`verify.mjs` checks the manifest, the chain, the signature, every blob against its content
address, and recomputes every claim verdict. `rederive.mjs` goes further: it recomputes every gate
status from the recorded exit code and output under the rule the record names, every ratchet
decision from its recorded measures, every bond and every claim, and names what it cannot
re-derive rather than agreeing with it.

Shown running in a `node:24` container with no network and no mount of this repository, exit 0 on
the committed bundle and exit 1 on the same bundle one byte later:
[`clean-container-verification.md`](evidence/2026-08-23/clean-container-verification.md).

## Identity

A bundle carries the public key its own signature verifies against, so checking it against itself
can only say "unchanged since written". Anyone can edit a bundle, rehash it, sign it with a key of
their own and ship that key in the manifest.

```sh
swarm verify <bundle> --signer <fingerprint>
```

Named and matching is trusted. Named and not matching is untrusted, with both fingerprints in the
message. No signer named is untrusted rather than trusted, and an ephemeral key is never trusted
whatever the policy says, because the run generated it for itself.

Beside the bundle signature every run writes a DSSE envelope binding the patch, the spec digest,
the source commit, the chain head and the verdict under one signature, so a diff and a bundle can
be shown to be about each other.
