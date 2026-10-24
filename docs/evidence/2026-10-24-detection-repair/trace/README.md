# False acceptance trace: `ufo-feature-filter-query.swarm` (delivery confirmation, build d5a666588)

Sources. Session ledger and blobs: `~/.cache/swarm-study-2026-10-24/confirm/runs/sessions/ufo-feature-filter-query.swarm/` (session `20261024T085620-fdec11`; `ledger.jsonl` is byte-identical to `bundle/ledger.jsonl`). Runner record: `~/.cache/swarm-study-2026-10-24/confirm/runs/ufo-feature-filter-query.swarm.json`. Hidden evaluator: `~/.cache/swarm-heldout-2026-10-23c/sealed/ufo-feature/behaviour-check.mjs`. Task text: `~/.cache/swarm-heldout-2026-10-23c/sealed/heldout-tasks.mjs` line 78. All `#N` below are ledger sequence numbers in that session. "Observed" means read from a record or reproduced here; "Inference" is marked as such.

Ledger payloads are written through the credential scrubber, so recorded copies of the code show `const keys = [redacted:credential-assignment]);` where the code has `const keys = Object.keys(parsed);` (and similarly for `hasMatchingKey = false/true`). The delivered patch blob `runs/blobs/73a46956...` is unscrubbed, and quotes below come from it (copied to `delivered.patch` here).

## 1. The three failing hidden cases (observed)

The hidden check was rerun on a fresh clone of the task base with the delivered patch applied (`work/delivered/`). Its output is byte-identical to the sealed detail blob `runs/blobs/e3821d8573dbe678...` apart from a trailing newline. The reproduction used jiti 2.6.1 from another tree rather than the pinned 2.7.0; it only loads the TypeScript source. The full text of the truncated third case comes from `full-predicate-case.mjs`.

1. `accept all: "file:///C:/x?bar=1&k=v"`: `filterQuery(input, () => true)` returned `'file:///C:/x?bar=1&k=v'`; expected `'file://C:/x?bar=1&k=v'`, which is what `withQuery("file:///C:/x?bar=1&k=v", {})` returns on the base (`parseURL` gives `{protocol:"file:", host:"", pathname:"C:/x", search:"?bar=1&k=v"}`).
2. `filter: "file:///C:/x?bar=1&k=v" with (key) => key !== "bar"`: returned `'file:///C:/x?k=v'`; expected `'file://C:/x?k=v'`.
3. `the predicate sees each decoded key once, in order, with getQuery's value`: for `filterQuery("/p?b=2&a=1&a=3&caf%C3%A9=x&e", ...)` returning true, the predicate was called with `[["b","2"],["b","2"],["a",["1","3"]],["café","x"],["e",""]]`; expected `[["b","2"],["a",["1","3"]],["café","x"],["e",""]]`. Untruncated assertion text:

```
Expected values to be strictly deep-equal:
+ actual - expected

  [
    [
      'b',
      '2'
    ],
    [
+     'b',
+     '2'
+   ],
+   [
      'a',
      [
        '1',
        '3'
      ]
```

## 2. Per failure

### What was delivered (shared by all three)

From `delivered.patch` (ufo/src/utils.ts):

```ts
  const queryIndex = input.indexOf("?");
  if (queryIndex === -1) {
    return input;
  }

  const beforeQuery = input.slice(0, queryIndex);
  // The fragment is after any "?" so find it after the query
  const fragmentStart = input.indexOf("#", queryIndex);
  ...
  const parsed: ParsedQuery = parseQuery(postQuery);
  const keys = Object.keys(parsed);

  // Check if any key passes the predicate
  let hasMatchingKey = false;
  for (const k of keys) {
    if (predicate(k, parsed[k])) {
      hasMatchingKey = true;
      break;
    }
  }

  if (hasMatchingKey === false) {
    return beforeQuery || "/";
  }

  // Rebuild query string from kept keys
  const keptQuery: QueryObject = {};
  for (const k of keys) {
    if (predicate(k, parsed[k])) {
      keptQuery[k] = parsed[k];
    }
  }

  const queryString = stringifyQuery(keptQuery);
  return beforeQuery + "?" + queryString + fragment;
```

For comparison, base `withQuery` (ufo/src/utils.ts lines 267-272) is `parseURL(input)` then `stringifyQuery`, then `stringifyParsedURL(parsed)`. The worker read this whole file at #50.

### Failures 1 and 2: `file:///C:/x?...` kept verbatim instead of rebuilt as withQuery rebuilds it

(a) Task sentence: "Otherwise predicate is called once for each key of getQuery(input), in that order, with the decoded key and the value getQuery gives it (a string, or an array of strings for a repeated key, so a repeated key is kept or dropped as a whole), and the URL is rebuilt the way withQuery rebuilds it: filterQuery(input, () => true) equals withQuery(input, {}) for every input that contains "?"; protocol, auth, host, path and fragment are kept as withQuery keeps them; the kept parameters are encoded as withQuery encodes them; and the "?" is left out when no parameter remains."

(b) Implemented: `beforeQuery + "?" + queryString + fragment`, where `beforeQuery = input.slice(0, queryIndex)`. The text before `?` is copied unchanged, never passed through `parseURL` and `stringifyParsedURL`.

(c) What ran on the candidates (observed):
- The worker's own tests (`test/query.test.ts`, gate `tests` at #292, #477, #606, and its shell runs at #121, #149, #162, #175, #207, #222, #441, #516, #558, #565). The `?` inputs compared against `withQuery` were `"/foo?bar=1&baz=2"` and `"/foo?"`, and the only other absolute input with `?` was `https://example.com/p?q=%20x&bar=1`. For these, string slicing and `parseURL`/`stringifyParsedURL` agree. The only `file:///` input was `"file:///C:/x"` with no `?`, which takes the early return.
- The supplied visible check (goal-check #301, #486, #593, #615, #647; worker shells #214, #261, #448, #532; runner after delivery): one case, `filterQuery("/foo?bar=1&baz=2", (key) => key !== "bar") === "/foo?baz=2"`.
- Independent verification (#303, #488, #617, #649): build, lint, tests over the base and the patch. It runs the repository's own checks, no filterQuery-specific input.
- `behaviour-probe` gate: `not-applicable`, "no changed function could be probed" (#296, #481, #610).
- Review probes: the two admitted probes test `withQuery` and `getQuery`, not filterQuery, and never loaded (#378, #389, #500, #629). The dropped `filterQuery-core-behavior` probe (#365, #390) used `"file:///C:/x"` with no `?`.
- try_probe: one trial (#359), a `require` program that did not load.
- No executed check used an input whose text `parseURL`/`stringifyParsedURL` would change.

(d) Why no correction: no observation ever failed on this behaviour, because no check had such an input. The repair prompts (#393, #505) named only lint findings (unicorn/no-negated-condition, then prettier test/query.test.ts). The requirement sentence was not an obligation: preservation-obligations-v2 at #2 put it under `unclassified` ("not read as an obligation, and nothing measures it"), and #651 shows it still there at settlement. Its "Working state" lists in #393 and #505 quote only keep sentences.

(e) Origin: initial implementation. The first write of `filterQuery`, at #85 (08:56:52, initial loop), already builds the result as `pre + "?" + queryString`. Replaying every recorded `ufo/src/utils.ts` edit over the base (`replay-utils-edits.mjs`, final version byte-identical to the delivered file) and running the hidden check on each version: after #85 it fails 8 cases including both file:/// cases; after #128, #403 and #428 it fails exactly these 3 cases. #128 (initial loop) fixed fragment handling. #403 and #428 (repair attempt 1) were lint-only rewrites (`keepAny` renamed to `hasMatchingKey === false`, the `!== -1` branch inverted). Attempt 2 changed only formatting in `test/query.test.ts` (#509). Runner snapshots: attempt-0 candidate `80c3d348...`, attempt-1 candidate `79658bf2...`, delivered `73a46956...`. The attempt-1 and delivered `ufo/src/utils.ts` are identical (blob `9b35880`).

### Failure 3: predicate called twice for the first kept key

(a) Task sentence: "Otherwise predicate is called once for each key of getQuery(input), in that order, with the decoded key and the value getQuery gives it (a string, or an array of strings for a repeated key, so a repeated key is kept or dropped as a whole), ..." (the same sentence as above, first clause).

(b) Implemented: two passes over `keys`, both calling `predicate`. The "any key passes" pass stops at the first true, then the rebuild pass calls `predicate` again for every key (code quoted above). Keys come from `parseQuery(postQuery)` on a string slice, not `getQuery(input)`. That second divergence is not what the hidden case caught.

(c) What ran (observed). This behaviour was directly observed failing in the initial loop:
- #115 added a test "predicate gets decoded key and value". Its first form failed at #121 on an unrelated wrong expectation (`expected '&x' to be '='`).
- #142 rewrote it to `expect(calls.length).toBe(2)` for `"/foo?key=%2Bval&key2=val2"`. #149 failed: `AssertionError: expected 3 to be 2`.
- #156 changed the input to `"/foo?key=val1&key2=val2"`. #162 and #175 failed the same way: `expected 3 to be 2`, test/query.test.ts:199.
- #182: a debug script importing `./src/parse.ts` with plain node failed to load (`ERR_MODULE_NOT_FOUND .../src/encoding`).
- #201 deleted the test (find 464 chars, replace with nothing). #207 then passed (491 tests).
- After #201, nothing executed counted predicate calls: not the tests gate, the visible check, independent verification, the review probes (none loaded, none targeted filterQuery), or the behaviour-probe gate (not applicable).

(d) Why no correction. Observed:
- The worker misattributed the failure. #157: "The `+val` is being parsed as three separate keys". #184 and #196 suspected `parseQuery`.
- #202: "Let me simplify it and also just remove it since all my data-driven tests already verify behavior".
- The deletion happened inside the initial loop, before any gate cycle. The first gated candidate (#287 onward) never contained the test, so no gate, ratchet measure or regression-test record saw a removal. #632 compares attempt 0 against the base: assertions 2 to 3, accepted. #633 records `testsRemoved: []`.
- The repair prompt for attempt 1 (#393) did reprint the #162 and #175 outputs ("- 2 / + 3") in its executions list. It marked them as predating the last tree, and the gate section named only the lint finding. The attempt-1 worker acted only on lint (#398 to #468).

Inference: the harness had the signal on record (three failing runs of a worker-written test about call count), but the worker's own deletion was not a protected change, so the signal was discarded.

(e) Origin: initial implementation, the first write #85. The two-pass structure (`keepAny` loop then rebuild loop) is in #85 and survives every later edit unchanged. Replay: the case fails after #85, #128, #403 and #428.

## 3. The review (`--review executable`, candidate-review-v2)

Observed:
- Declared at #3: mode executable. Its note says "once the gates are green", but the review was asked at 08:59:02 (#305) right after gate cycle 0, where lint (#290) and task-acceptance (#304) had failed. This is consistent with the stage's README change "It no longer waits for green".
- Asked once only. It was not asked again after attempts 1 or 2. The admitted probes were only rerun (`remeasured` #501, #630).
- Prompt (#305 system, #307 user):
  - the full task text and the attempt-0 diff (recorded with the scrubber's redaction);
  - obligations listed with ids: `task-keep-1..3`, `contract-visible-check`, `base-suite`;
  - an instruction to look "above all for existing behaviour the change broke that the task requires kept";
  - requirement probes are allowed, but "reported and never acted on";
  - 9 tool calls.
- Tool calls:
  - #311 list `.`, #317 list `src`;
  - #323 read `ufo/src/index.ts`, #329 read `ufo/src/utils.ts`, #335 read `test/query.test.ts`;
  - #341 list `acceptance/visible`, #347 read `acceptance/visible/check.mjs` (which imports the source through jiti);
  - #353 read `ufo/src/query.ts`;
  - #359 try_probe, "try 1 of 4", program `const { execSync } = require('child_process'); ... node acceptance/visible/check.mjs`, input `[{}]`. Result: "the program did not load: ReferenceError: require is not defined in ES module scope".
- Answer (#365), four probes:
  - `visible-check-passes`: basis requirement, `keeps: null`, execSync of the visible check.
  - `preserve-withQuery` (task-keep-1): imports `./src/index.js`, checks `withQuery("/x?bar",{})`, `withQuery("/foo?",{})` and `withQuery("/p?x=1&&bar=2&",{})`.
  - `preserve-getQuery-no-prototype` (task-keep-1): imports `./src/index.js`, input `http://foo.com?__proto__=evil&constructor=bad&real=val`.
  - `filterQuery-core-behavior`: basis preserve, `obligation: null`, imports `./src/index.js`. It runs six fixed (predicate, expected) pairs against each of 6 inputs and returns `allPass`. Inputs: `/foo?bar=1&baz=2`, `/foo?bar=1`, `/foo?a=1&a=2&bar=3#frag`, the same two again, and `file:///C:/x`.
- Admission (#390):
  - admitted: `preserve-with-query`, `preserve-get-query-no-prototype`;
  - dropped `visible-check-passes`: "not a probe: keeps: Invalid input: expected string, received null";
  - dropped `filter-query-core-behavior`: "not a probe: obligation: Invalid input: expected string, received null".
  - Commit fb1c417bc (after this build) cites exactly these two null fields: "two live probes were dropped for `"keeps": null` and `"obligation": null`".
- What loaded: nothing. Every run of both admitted probes, on the base and on the candidate, at #378, #389, #500 and #629, exited 3 with `ERR_MODULE_NOT_FOUND: Cannot find module '.../src/index.js'`, and #390 classifies both as `did-not-load`. The ratchet's `candidate-review` parts are empty (#502, #631). #651 settles task-keep-1 as `unmeasured`.
- Cost: 10 steps, 96,343 tokens, 48.9 s (#366, #390).

Inference about the dropped filterQuery probe:
- Admitted, it would not have loaded either, because it imports `./src/index.js`.
- Loaded, its program could not return `allPass: true` for any input: it checks six different expected outputs against one input.
- Its basis was preserve, so its expectation would come from the base, where filterQuery does not exist.
- None of its inputs reach the three failing cases: its only file:/// input has no `?`, and it never counts predicate calls.

## 4. Timeline

| Seq | Time (UTC) | Event |
| --- | --- | --- |
| #2 | 08:56:20 | Preservation obligations declared. The requested-behaviour sentences go to `unclassified`. |
| #3 | 08:56:20 | Review declared (candidate-review-v2, executable). |
| #4 | 08:56:20 | Goal contract: one check, `visible-check` (`node acceptance/visible/check.mjs`). |
| #10, #11 | 08:56:30 to 08:56:34 | Base preflight. The visible check is rejected on the base ("filterQuery is not a function"). Base lint fails (prettier src/punycode.ts). |
| #14, #17, #19 | 08:56:34 to 08:56:35 | Session started (attemptCap 3, maxSteps 40). Gate set sealed. Checks: build, lint, tests. |
| #75, #79 | 08:56:47 | File set declared (`ufo/src/index.ts`, `ufo/src/utils.ts`), then amended to add `test/query.test.ts`. |
| #85 | 08:56:52 | First write of filterQuery. All three defects are present from here. |
| #115, #121 | 08:57:07 to 08:57:11 | Tests added. Two failures: the fragment case and the predicate test. |
| #128 | 08:57:22 | Fragment handling fixed. |
| #142 to #175 | 08:57:29 to 08:57:46 | The predicate-count test fails three times (`expected 3 to be 2`). |
| #182 | 08:57:50 | Debug script does not load. |
| #201 | 08:58:03 | Predicate-count test deleted. |
| #207, #214 | 08:58:05 to 08:58:11 | Suite passes (491). Visible check passes. |
| #236 to #280 | 08:58:11 to 08:58:39 | Six claims denied as invalid input. |
| #285 | 08:58:39 | Initial loop completed: 38 steps, 1.08M tokens. |
| #287 to #304 | 08:58:41 to 08:59:02 | Gate cycle 0. Build passed (wrote README.md, put back). Lint failed with a new finding (unicorn/no-negated-condition). Tests passed. Policy gates passed. behaviour-probe not applicable. Visible check accepted (#302). Independent verification: regression fail (#303). Task-acceptance failed (#304). |
| #305 to #390 | 08:59:02 to 08:59:51 | Review: four probes, two dropped, two did not load. Nothing established. |
| #391 | 08:59:51 | Snapshot before attempt 1. |
| #393 to #472 | 08:59:51 to 09:00:18 | Attempt 1 (repair for lint). #403 and #428 were lint-only edits. Completed in 13 steps. |
| #473 to #489 | 09:00:20 to 09:00:39 | Gate cycle 1. Lint failed with a new finding (prettier test/query.test.ts). Tests passed. Visible check accepted (#487). Task-acceptance failed (#489). |
| #492 to #501 | 09:00:42 to 09:00:48 | Review probes remeasured: did not load. |
| #502 | 09:00:48 | Ratchet, attempt 1: accepted. |
| #503 to #601 | 09:00:48 to 09:01:22 | Attempt 2 (repair for prettier). #509 `prettier --write test/query.test.ts`. #596 `run_check visible-check`: accepted. Completed in 14 steps. |
| #602 to #618 | 09:01:23 to 09:01:42 | Gate cycle 2. Lint failed, inherited only. Tests passed. Visible check accepted (#616). Independent verification: regression pass, verified (#617). Task-acceptance passed (#618). |
| #621 to #630 | 09:01:45 to 09:01:51 | Review probes remeasured: did not load. |
| #631, #632 | 09:01:51 | Ratchet: attempt 2 accepted. Base-scope ratchet (attempt 0 against base) accepted. |
| #633 | 09:01:51 | regression-tests-v1: the added test was not run on the base source (`indeterminate`). |
| #634 to #640 | 09:01:51 to 09:01:52 | Bonds held: tests, file-set, placeholder, secret-scan, diff-budget. Not bonded: build, task-acceptance. |
| #641 to #643 | 09:01:52 | Workspace diff. 1,533,401 tokens. Run assessment (run-acceptance-v6): acceptable. |
| #646 to #650 | 09:02:04 to 09:02:10 | Final verification. Visible check accepted (#648). Independent verification: regression pass, verified (#649). Run assessment (#650): acceptable, task accepted. |
| #651 | 09:02:10 | Preservation statuses. contract-visible-check met, base-suite held, task-keep-1..3 unmeasured, requested behaviour unclassified. |
| runner | after 09:02:23 | Visible check passed. Static: no introduced finding. Hidden behaviour check: 3 failures (false accept). Hidden kept check: passed. |

## 5. Additional observations (outside the three hidden failures)

These came from `extra-divergences.mjs`, which compares the delivered code with the sealed reference patch on extra inputs.
- The delivered code drops a fragment when no parameter remains: `filterQuery("/foo?bar=1#frag", () => false)` gives `"/foo"`, where the reference gives `"/foo#frag"`. The worker's own delivered test asserts `"/foo"` under the comment "Fragment preserved when params removed". So the run's tests lock in this divergence.
- It returns `"/"` for `filterQuery("?bar=1", () => false)`, where the reference gives `""`.
- It reads a `?` inside a fragment as a query: for `"/foo#h?bar=1"`, the predicate is called, while the reference makes no call.
- The hidden check does not cover any of these.

## Scripts (this directory)

`dump-ledger.mjs`, `tool-calls.mjs`, `gates.mjs`, `indep.mjs`, `show.mjs`, `user-messages.mjs`, `assistant-texts.mjs` read the ledger. `replay-utils-edits.mjs` reconstructs each `ufo/src/utils.ts` version. `full-predicate-case.mjs` and `extra-divergences.mjs` run the cases. Checkouts are under `work/` (base, delivered, reference, and v85, v128, v403, v428). Patches: `delivered.patch`, `candidate-attempt0.patch`, `candidate-attempt1.patch`.
