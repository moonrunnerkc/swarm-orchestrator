# Live end-to-end runs, 2026-08-18

Two real tasks, one frontier and one local, each in a scratch git repo, each exporting
a bundle its own embedded verifier then checked. Home paths in this file are written
as `~`. The bundles beside it are byte-exact and unredacted, for the reason in the
last section.

## The task

A two-file scratch repo with a naive `slugify` and one passing test. The task:
collapse whitespace runs, strip characters that are not letters, digits or hyphens,
and add tests for both.

## Frontier: anthropic:claude-sonnet-5

Bundle: `live-frontier/`. Verify it with `node live-frontier/verify.mjs live-frontier`.

```
step 1: calling anthropic:claude-sonnet-5
step 2: calling anthropic:claude-sonnet-5
step 3: calling anthropic:claude-sonnet-5
step 4: calling anthropic:claude-sonnet-5
step 5: calling anthropic:claude-sonnet-5
step 6: calling anthropic:claude-sonnet-5
step 7: calling anthropic:claude-sonnet-5
step 8: calling anthropic:claude-sonnet-5
step 9: calling anthropic:claude-sonnet-5
stopped: completed after 9 steps, 36982 tokens
routing reward: 0.232 (green with 0 retries, 22s, and $0.1327)
```

Gates, all harness-computed:

```
gates:
  n/a      typecheck: package.json declares no typecheck script
  n/a      lint: package.json declares no lint script
  n/a      format: package.json declares no check-only format script, and running a writing formatter as a gate would edit the tree it is judging
  passed   tests: 3 collected, 3 passed, 0 failed, 0 skipped (exit 0)
  passed   file-set: all 2 changed file(s) are inside the declared set of 2, and every one of them was declared before it was edited
  passed   placeholder: no placeholder marker was introduced by this change
  passed   secret-scan: no known credential pattern appears in the added lines
  passed   diff-budget (advisory): within budget: 2 file(s) and 13 added line(s)

```

The one claim the model made, and what the harness did with it:

```
tool claim <- {"predicate":"facts.exitCode == 0","record":"sha256:6923ca045124b4b7f5995453ffa53877372f2365384ba5756ed68d86627c753b","recordKind":"tool-call:shell","narrative":"node --test src/slugify.test.mjs passed all 3 tests including the new whitespace-collapsing and non-alphanumeric-stripping cases."}
tool claim ok: VERIFIED: the harness evaluated the predicate against the cited tool-call:shell record and it held
```

Its closing summary rendered as unverified prose, which is invariant 1 working: the
narrative cannot render green, only the predicate against a named record can.

### Verifier output

```
verifying bundle at live-frontier

  VERIFIED   record 28: facts.exitCode == 0

  PASS  manifest reads: bundle format 1, session 20260818T145619-d5dd08
  PASS  ledger parses: 42 of 42 lines
  PASS  record count matches the manifest: 42 records, manifest says 42
  PASS  hash chain intact: 42 links
  PASS  chain head matches the manifest: computed sha256:6dafa1f811723f7c2b4dcff7bab7cdb6151fc2154dc0afebb5faf11824a14041
  PASS  signature over the chain head verifies: ed25519, keychain key
  PASS  blobs match their content addresses: 42 blobs
  PASS  every record's payload is present: all payloads resolve
  PASS  claim verdicts recomputed: 1 verified, 0 unverified; manifest says 1 verified

bundle verified: every check passed
```

## Local, and it took three attempts to get one

Recorded in full because two of the three failed, and a local-model claim that rests
only on the third would be the kind of thing this tool exists to catch.

| Attempt | Endpoint and model | Result |
| --- | --- | --- |
| 1 | rapid-mlx :8000, `qwen3-coder:30b-a3b` | server-side failure after 4 steps: `Internal error during streaming: Can only get item pairs from a mapping`. Nothing was edited. |
| 2 | Ollama :11434, `mistral-small3.2:24b` | declared a file set naming two files that do not exist in the repo, wrote nothing, stopped after 2 steps. Nothing was edited. |
| 3 | Ollama :11434, `qwen3.6:35b-mlx` | completed in 15 steps, 2 files changed, 8 tests collected and passing. |

Attempt 2 is what found the reward defect fixed in `c300bbe0`: every gate passed over
the untouched tree, correctly, and the routing reward scored that no-op 0.846 because
it was fast and free. It now scores 0.000 and says why.

Bundle: `live-local/`, from attempt 3.

```
stopped: completed after 15 steps, 0 tokens
routing reward: 0.788 (green with 0 retries, 32s, and $0.0000)
```

```
gates:
  n/a      typecheck: package.json declares no typecheck script
  n/a      lint: package.json declares no lint script
  n/a      format: package.json declares no check-only format script, and running a writing formatter as a gate would edit the tree it is judging
  passed   tests: 8 collected, 8 passed, 0 failed, 0 skipped (exit 0)
  passed   file-set: all 2 changed file(s) are inside the declared set of 2, and every one of them was declared before it was edited
  passed   placeholder: no placeholder marker was introduced by this change
  passed   secret-scan: no known credential pattern appears in the added lines
  passed   diff-budget (advisory): within budget: 2 file(s) and 33 added line(s)

```

The diff it produced:

```diff
diff --git a/src/slugify.mjs b/src/slugify.mjs
index 946190e..8f70e71 100644
--- a/src/slugify.mjs
+++ b/src/slugify.mjs
@@ -1,3 +1,6 @@
 export function slugify(title) {
-  return title.toLowerCase().split(" ").join("-");
+  return title
+    .toLowerCase()
+    .replace(/[^a-z0-9]+/g, "-")
+    .replace(/^-|-$/g, "");
 }
```

### Verifier output

```
verifying bundle at live-local

  VERIFIED   record 46: facts.exitCode == 0

  PASS  manifest reads: bundle format 1, session 20260818T150259-84acfe
  PASS  ledger parses: 60 of 60 lines
  PASS  record count matches the manifest: 60 records, manifest says 60
  PASS  hash chain intact: 60 links
  PASS  chain head matches the manifest: computed sha256:6efe7d9589dced220f3288b2de66e965aae27c485103d7b3dccbefc19a68e825
  PASS  signature over the chain head verifies: ed25519, keychain key
  PASS  blobs match their content addresses: 60 blobs
  PASS  every record's payload is present: all payloads resolve
  PASS  claim verdicts recomputed: 1 verified, 0 unverified; manifest says 1 verified

bundle verified: every check passed
```

## Keychain signing, live

Both bundles carry `"keySource": "keychain"` in the manifest signature, so invariant 11's
keychain half ran outside a unit test for the first time. The key is a real login-keychain
item, service `swarm-orchestrator`, account `bundle-signing-key`, and both verifier runs
above report `signature over the chain head verifies: ed25519, keychain key`.

## Why these bundles are not redacted

Both hold six occurrences of an absolute home path, three in one blob and three in the
`review.html` that renders it, and every one is the same string: the coverage destination
the harness named for the test runner, `~/.swarm/sessions/<id>/coverage/tests.lcov`. Invariant 7 requires that path to be outside the workspace and named
by the harness, so it is evidence rather than an accident, and it carries no credential
material. The export scrubber ran: the secret-scan gate passed on both runs and the ledger
holds no credential pattern.

Editing those bytes would change the blob they sit in, which changes its content address,
which breaks the hash chain and the signature over its head. The bundle would stop
verifying, and a bundle that does not verify is not evidence of anything. So the artifact
stays byte-exact and the prose around it writes home paths as `~`.

Re-running under a neutral `HOME` was tried first and is not a way out: the run reached
green gates and then blocked at bundle export, because reaching the login keychain from a
process whose `HOME` points elsewhere waits on a UI prompt that never comes in a headless
shell. It was killed at ten minutes with no bundle written. Keeping the real home is what
keeps `keySource: keychain` true.
