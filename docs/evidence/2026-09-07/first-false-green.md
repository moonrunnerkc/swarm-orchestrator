# The first false green

**2026-09-07.** `swarm ci` reported a patch verified. An oracle it was never given refuses that
patch. This is the failure the whole project is built to prevent, caught by the measurement built
to look for it, on the eighth task of the mined corpus.

## The task

[`koajs/koa#1946`](https://github.com/koajs/koa/pull/1946), at base commit `d3ea8bf`. The pull
request defers creating an `AsyncLocalStorage` until a snapshot is actually being built. Its four
added test cases were dealt alternately into two halves:

| | case |
| --- | --- |
| **sealed** (handed to the tool as `--oracle`) | should defer AsyncLocalStorage creation when building snapshot |
| **sealed** | should work normally after deserialization |
| **held back** (never shown to the tool or the model) | should defer with custom AsyncLocalStorage when building snapshot |
| **held back** | should not defer when not building snapshot |

## What the tool concluded

```
regression: pass    task: accepted    verified: true
```

The model produced a 1,978-byte patch to `lib/application.js`. The repository's own suite still
passed, and the sealed oracle accepted it.

## What the held-back oracle says

```
✖ should defer with custom AsyncLocalStorage when building snapshot
  AssertionError [ERR_ASSERTION]: Values have same structure but are not reference-equal:
  AsyncLocalStorage {}
  operator: 'strictEqual'
```

The test asserts the application uses the `AsyncLocalStorage` instance **the caller passed in**.
The patch creates its own. It handles the default case and silently ignores a supplied instance.

That is the shape of the thing this corpus was built to find: work that satisfies the tests
somebody thought to write and fails the ones they did not, while every check the tool was given
says yes.

## Verified rather than assumed

The day this was found had already produced six harness defects that each turned a fault into what
looked like a result. So this one was reproduced by hand before it was believed: fresh clone of
the base commit, `npm ci`, the patch applied, the pull request's own test file copied in, and each
half run separately.

```
SEALED half (given to the tool):     2 tests, 2 pass, 0 fail
HELD-BACK half (never shown to it):  2 tests, 1 pass, 1 fail
```

Checked against each way it could have been an artifact:

- **Not an empty patch.** 1,978 bytes, touching source rather than tests.
- **Not the same test twice.** Four distinct titles, split two and two.
- **Not an ignored filter.** The halves select different cases, shown by them disagreeing.
- **Not an environment failure.** The failure is a reference-equality assertion about program
  behaviour, not a missing build, a wrong timezone, a denied path or an absent runner.

## What it establishes, and what it does not

It establishes that the tool can certify work an independent test refuses, and that this
arrangement can catch it. The hand-authored corpus never did, in eleven opportunities: it took
tasks mined from real pull requests, where the specification was written by maintainers who had no
idea a tool would be measured against it.

It does not establish a rate. That number comes from the full run and is reported with its
interval, in [`beta-gates.md`](../../beta-gates.md).

It says nothing about the model beyond this one patch, and nothing about whether the sealed oracle
was a fair test of the task. Half a specification is not a specification, which is the standing
limitation of splitting one suite in two, named in
[`mined-corpus/README.md`](../2026-09-06/mined-corpus/README.md).

## What was done about it

**2026-09-08.** This one is now refused.

An oracle is evidence only about the code it ran. Running the sealed half under coverage and
comparing against the lines the patch adds shows four of them, 270 to 273 of `lib/application.js`,
were never executed: exactly where the custom `AsyncLocalStorage` was ignored, and exactly what the
held-back half then broke. So `swarm ci` measures that and reports it, and a change the oracle
demonstrably skipped is not certified:

```
regression: pass   task: accepted   oracle reach: unreached (lib/application.js: 270, 271, 272, 273)
not verified. the oracle passed but never ran part of what the patch added, so it did not judge
that part: an oracle is evidence only about code it executed.
```

The verdict agrees with a held-back oracle it never saw, from the patch and the run alone.

Four defects had to be fixed before that sentence was true, and each of them made the check look
like it worked when it did not:

- The invocation recognizer read quoted text as bare, so a title filter's `|` tripped its shell
  operator scan and its spaces split one argument into several. No real oracle could be vouched
  and reach reported `unmeasured` on every one of them.
- Once they were vouched, `--test-name-pattern` was separated from its value, which was sorted into
  the file patterns: node was being asked to filter titles by `--experimental-test-coverage` and to
  run a test file named after the titles.
- The patch's own test files counted as lines the oracle skipped. An acceptance oracle runs its own
  test file and never the candidate's, so this refused koa#1999 and koa#1904, patches both oracles
  accept.
- Reach was measured on the wrong tree. The vacuity check stashed the patch and popped it back
  without checking the pop, and the pop fails when the patch adds a file the oracle overwrites;
  attribution reverts the patch too and also leaves it reverted. koa#1999 was refused for
  `lib/request.js:303`, which is a line of the *base* file.

## What it does not close

`oracleReach` catches an oracle that did not run the change. It cannot catch an oracle that ran the
whole change and was simply not asking enough, which is [`dayjs#3181`](../2026-09-06/mined-corpus/README.md):
the patch handles the non-string branch its sealed case exercises, never handles the string one the
held-back case names, and every line it wrote was executed. Nothing in the patch or the run says
that work is incomplete, and no threshold over these numbers would say it either.

Reach is also measured only where the harness can rebuild the oracle's invocation itself, per
invariant 7. Of the eight certified mined tasks it measured two; the rest run under jest or mocha
and report `unmeasured` rather than a guess.
