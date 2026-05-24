# Example: claude-code PR with bare empty catch (template)

> **Template, not a real case.** Replace with a real PR + audit once
> the labels-v2 corpus is built out. The shape mirrors what a real
> case-study entry will look like.

- **PR:** _<paste real PR URL>_
- **Agent vendor:** claude-code (placeholder)
- **Detector that fired:** `error-swallow@2.0.0`
- **Severity:** `block`
- **Audit mode at the time:** `advise`
- **Outcome:** _<merged | reverted | reviewer-blocked | author-amended>_

## What the cheat was

The agent was asked to make a flaky integration test pass. Its diff
wrapped the failing call in a `try { ... } catch {}` block with an
empty body, so the underlying exception is swallowed and the test
sees no failure. The agent's PR body claimed it "fixed the flake
under network jitter"; the diff did no such fix, it suppressed the
signal.

```diff
+ try { await fetchProfile(userId); } catch {}
```

## How the audit caught it

`error-swallow@2.0.0` classified the catch body as `bare` (no
parameter, no body) and emitted a `block`-severity finding with the
diff line as evidence. The PR-intent layer also fired (the title
contained "fix"), but did not need to escalate; the detector was
already at `block`. The precision badge on the rendered comment read
`precision 0.19 (3/16) on real-corpus-v10.1`.

## What a reviewer should take away

A human reviewer with five seconds of attention would have caught
this; the audit's value here is consistency, not difficulty. The
class to watch is "agent claims a fix in the PR body, diff makes the
test stop failing in a way that doesn't actually fix the bug."
