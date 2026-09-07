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
