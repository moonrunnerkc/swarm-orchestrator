# Verifying without a model

Three commands need no model, no API key and no local backend: `swarm verify` checks a bundle,
`swarm ci` verifies a patch in a fresh checkout of its base, and `swarm gates` measures a
workspace. This page walks through each one. Every transcript below was captured from the
command it sits under, run with an environment holding nothing but `PATH` and `HOME`.

Install the tool as usual; nothing else is needed:

```sh
npm install -g swarm-orchestrator
```

## swarm verify: a bundle, and who signed it

The bundle at `docs/evidence/2026-08-18/live-frontier` is a real run, committed with its ledger,
its payloads and its own verifier. Check it from a clone of this repository:

```sh
swarm verify docs/evidence/2026-08-18/live-frontier
```

```
integrity:  valid (installed verifier checked the ledger, payloads and recorded verdicts)

  VERIFIED   record 28: facts.exitCode == 0

  PASS  manifest reads: bundle format 1, session 20260818T145619-d5dd08
  PASS  ledger parses: 42 of 42 lines
  PASS  record count matches the manifest: 42 records, manifest says 42
  PASS  hash chain intact: 42 links
  PASS  chain head matches the manifest: computed sha256:6dafa1f811723f7c2b4dcff7bab7cdb6151fc2154dc0afebb5faf11824a14041
  PASS  signature over the chain head verifies: ed25519, keychain key
  PASS  blobs match their content addresses: 42 blobs
  PASS  every record's payload is present: all payloads resolve
  PASS  manifest blob inventory matches the ledger: every referenced payload must be listed and present
  PASS  claim verdicts recomputed: 1 verified, 0 unverified; manifest says 1 verified
  PASS  gate runs conform to the sealed criteria: no criteria sealed: this bundle format predates sealing

bundle verified: every check passed
```

The re-derivation follows, one line per verdict recomputed from the recorded bytes, and then
the signer:

```
signer:     untrusted
            the signature verifies against the key shipped in the bundle (sha256:db270183c40c65843cacd2b3dcf20ee249d146d98c56699b2f3512ebeb84a52a), but no expected signer was named, so this shows the bundle is internally consistent and not who made it. Name an expected signer to check authenticity
fingerprint: sha256:db270183c40c65843cacd2b3dcf20ee249d146d98c56699b2f3512ebeb84a52a
attestation: none. This bundle binds its evidence to itself and to nothing else, so a patch beside it is not shown to be the patch it describes.
```

The exit code is 1, and that is deliberate. A bundle carries the public key its own signature
verifies against, so checking it against itself can only say "unchanged since written". Exit 0
needs the signer you expect, named from outside the bundle:

```sh
swarm verify docs/evidence/2026-08-18/live-frontier \
  --signer sha256:db270183c40c65843cacd2b3dcf20ee249d146d98c56699b2f3512ebeb84a52a
```

Now change one byte. The tamper demo beside the bundle flips the last digit of record 28's
timestamp and nothing else:

```sh
node docs/evidence/2026-08-18/tamper-demo/flip-one-byte.mjs \
  docs/evidence/2026-08-18/live-frontier /tmp/tampered
swarm verify /tmp/tampered
```

```
integrity:  invalid (installed verifier checked the ledger, payloads and recorded verdicts)

  VERIFIED   record 28: facts.exitCode == 0

  PASS  manifest reads: bundle format 1, session 20260818T145619-d5dd08
  PASS  ledger parses: 42 of 42 lines
  PASS  record count matches the manifest: 42 records, manifest says 42
  FAIL  hash chain intact: record 28 carries previousHash sha256:82a471cc7bca02de8c4020cbdb55bcb7d8dc9ad16c73ffede431f906c707eed2, but the record before it hashes to sha256:a0546cfd8cc4da7f60fdc9009494a94386bd9eca9471fa4105836cfc312f829b
```

Nothing about the run's result changed: no gate outcome, no claim, no payload. The chain still
catches it. The same demonstration, with both transcripts in full, is
[`tamper-demo/README.md`](evidence/2026-08-18/tamper-demo/README.md).

Without this tool at all, the bundle's own verifier does the integrity half:

```sh
node docs/evidence/2026-08-18/live-frontier/verify.mjs docs/evidence/2026-08-18/live-frontier
```

It imports nothing outside node's builtins. Shown running in a `node:24` container with no
network and no mount of this repository in
[`clean-container-verification.md`](evidence/2026-08-23/clean-container-verification.md).

## swarm ci: a patch, in a checkout nothing that produced it can reach

`swarm ci` clones the base commit somewhere fresh, applies the patch there, runs the checks
there, and reports two answers: `regression`, whether the repository's own suite still passes,
and `task`, whether the work was done, which only an oracle can say. Nothing the producer said
travels except the patch.

The worked example is a small project you create, because the command needs a git repository
holding the base commit the patch is against. The base carries the project's own two tests and,
as a third file, the test that specifies the task, which fails on the base because the task is
not done yet:

```sh
mkdir two-tests && cd two-tests && git init -q
cat > package.json <<'EOF'
{ "name": "two-tests", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }
EOF
cat > slugify.mjs <<'EOF'
export const slugify = (text) => text.trim().toLowerCase().replace(/\s+/g, "-");
EOF
cat > slugify.test.mjs <<'EOF'
import test from "node:test";
import assert from "node:assert/strict";
import { slugify } from "./slugify.mjs";
test("lowers and joins", () => assert.equal(slugify("Hello World"), "hello-world"));
test("trims", () => assert.equal(slugify("  padded "), "padded"));
EOF
cat > punctuation.test.mjs <<'EOF'
import test from "node:test";
import assert from "node:assert/strict";
import { slugify } from "./slugify.mjs";
test("strips punctuation", () => assert.equal(slugify("Hello, World!"), "hello-world"));
EOF
git add -A && git -c user.name=you -c user.email=you@example.com commit -qm "base"
```

Write the change, capture it as a patch, and put the tree back so the patch is the only thing
that carries it:

```sh
cat > slugify.mjs <<'EOF'
export const slugify = (text) =>
  text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
EOF
git diff > ../candidate.diff
git checkout -- slugify.mjs
swarm ci --patch ../candidate.diff
```

```
base: aae1321a9e178588f6cef51a7a1e0102c9d76837
  passed   tests: 3 collected, 3 passed, 0 failed, 0 skipped (exit 0)

regression: pass   task: unjudged   oracle reach: unmeasured
oracle bond: not-bonded (no mutant of the change could be built, so nothing was asked of the oracle)
not verified. the repository's own suite passed, which says nothing broke. It does not say the task was done: a suite tests the behaviour a project already had, and a task adds behaviour it did not. Pass --oracle <command> with a check that says whether the task was done.
```

Exit 1. The suite passed, so `regression` is a pass, and the task is `unjudged` because no
oracle was given, so nothing is verified. Name the oracle, which runs in the checkout:

```sh
swarm ci --patch ../candidate.diff --oracle "node --test punctuation.test.mjs"
```

```
base: aae1321a9e178588f6cef51a7a1e0102c9d76837
  passed   tests: 3 collected, 3 passed, 0 failed, 0 skipped (exit 0)

regression: pass   task: accepted   oracle reach: reached
oracle bond: vacuous
  accepted slugify.mjs:2:drop-chained-call, and no detector showed the mutant changed anything
    - text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    + text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
not verified. the oracle ran a line the patch added and then accepted a change to that same line (slugify.mjs:2:drop-chained-call), so running it established nothing about that line. Extend it to assert on the behaviour those lines decide, or leave them unjudged and say so.
```

Still exit 1, and this is the command earning its keep. The oracle accepted the patch and it
executed the line the patch added, so `task` is `accepted` and reach is `reached`. Then the
line was changed and the oracle was asked again: with `.trim()` dropped it still accepted, and
neither the oracle's own coverage nor the repository's suite showed the mutant changed anything.
Read the mutant before blaming the oracle. Once punctuation is collapsed to dashes and the ends
are stripped, whitespace at the ends is collapsed and stripped by the same two calls, so
`.trim()` is dead code and no test could witness its removal. The patch, not the oracle, is
what needs fixing:

```sh
cat > slugify.mjs <<'EOF'
export const slugify = (text) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
EOF
git diff > ../candidate.diff
git checkout -- slugify.mjs
swarm ci --patch ../candidate.diff --oracle "node --test punctuation.test.mjs"
```

```
base: aae1321a9e178588f6cef51a7a1e0102c9d76837
  passed   tests: 3 collected, 3 passed, 0 failed, 0 skipped (exit 0)

regression: pass   task: accepted   oracle reach: reached
oracle bond: held (1 mutant(s) of the change refused)
verified: no regression, and the oracle says the task was done.
```

Exit 0. What each verdict means, and what none of them establishes, is in
[`verifying.md`](verifying.md#the-oracle-is-judged-too).

Every flag: `--install` to install the checkout's dependencies from its lockfile with install
scripts off, `--immutable <a,b>` for paths the patch may not touch, `--json` for one
`swarm.ci.v1` line, and `--oracle-only` to judge a second oracle without re-running the suite.

## swarm gates: a workspace, measured

`swarm gates` runs the gates over the current tree with no model and no retries, hands each
passing gate a bond, and reports the nine-answer verdict. In the project above, with the change
applied:

```sh
git apply ../candidate.diff
swarm gates
```

```
project: node

  n/a      typecheck: package.json declares no typecheck script
  n/a      lint: package.json declares no lint script
  n/a      format: package.json declares no check-only format script, and running a writing formatter as a gate would edit the tree it is judging
  passed   tests: 3 collected, 3 passed, 0 failed, 0 skipped (exit 0)
  n/a      file-set: no scope was authorised: this run had no planner to declare one. 1 file(s) were observed as changed: slugify.mjs. Observed scope is not authorised scope, so this gate checked nothing about intent. Pass --allowed-files to have it check membership.
  passed   placeholder: no placeholder marker was introduced by this change
  passed   secret-scan: no known credential pattern appears in the added lines
  passed   behaviour-probe: 1 changed function(s) still answer to their inputs.
  passed   diff-budget (advisory): within budget: 1 file(s) and 2 added line(s)

bonds, one per gate that passed:
  tests: held. the tests gate refused the bond: 4 collected, 3 passed, 1 failed, 0 skipped (exit 1)
  placeholder: held. the placeholder gate refused the bond: 1 placeholder marker(s) introduced: swarm-falsification-bond.js:1 // TODO: swarm falsification bond
  secret-scan: held. the secret-scan gate refused the bond: 1 added line(s) match a known credential pattern: swarm-falsification-bond.env.example.js:1 (github-token)
  behaviour-probe: not bonded. no bond is defined for this gate, so its pass has not been shown capable of failing
  diff-budget: held. the diff-budget gate refused the bond: over budget: 2 file(s) against 12 and 603 added line(s) against 600. This does not block. It requires a justification claim citing this record.

verdict:
  assessment      accepted
                  final ratchet and bonds accepted the completed work
  integrity       unverified
  signer          untrusted
                  no expected signer was matched, so the signature shows the bundle is unchanged since it was written and not who wrote it
  executionTrust  restricted
                  commands ran under a lexical path and program policy, which is not containment
  policy          pass
                  placeholder, secret-scan, diff-budget passed
  mechanical      unmeasured
                  every static gate stood down (typecheck, lint, format)
  behavioral      pass
                  tests, behaviour-probe passed
  semantic        unmeasured
                  no check here judges whether the change means what the task asked for, and nothing in this system is allowed to: a model's opinion is not a verdict
  task            unjudged
                  no trusted task oracle was configured for this run
  humanApproval   not-required
                  this run did nothing that needs a person's decision

acceptable: yes (no blocking gate failed, no policy gate failed, and something executed the change)
```

Exit 0. `mechanical` is `unmeasured` rather than a pass, because the project declares no
typecheck, lint or format script and nothing static ran; `behavioral` is a pass because the
tests did. Every `swarm gates` run writes a bundle of its own under `~/.swarm/sessions/`, sealed
before anything ran and checkable with `swarm verify` like the one above. `--allowed-files
<a,b>` names the scope you authorise for the file-set gate; without it that gate reports what
it observed and abstains, since nobody was there to declare a scope.

## What these three do not need

None of them opens a model, reads a provider key, or probes for a local backend. A machine with
Node and git on it is enough. That is command definition data rather than a promise:
`src/cli-command-definitions.ts` marks each of the three as needing no model, and
`src/cli-verify-only.test.ts` runs every command so marked through the real CLI under an
environment holding no key, with the local endpoint pinned to a port nothing listens on, so a
command that started probing for a model would fail that test rather than pass on a machine
that happens to serve one. Signing a bundle uses a key from the OS keychain where there is
one; where there is none, the run signs with a per-run key, says so on stderr with a line
starting `[signing]`, and records `keySource: ephemeral` in the manifest, which `swarm verify`
then reports as an ephemeral signer rather than a trusted one.
