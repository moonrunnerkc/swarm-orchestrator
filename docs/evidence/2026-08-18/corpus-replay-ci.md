# corpus-replay in CI, 2026-08-18

Item: prove the 1059-diff falsification corpus actually replays on GitHub Actions
rather than self-skipping. It did not. The fix and the proof are both below.

## Before, run 32150734348, commit ace2bda7

gates job green, and inside it:

```
src/gates/corpus-replay.test.ts (3 tests | 3 skipped) 12ms
Test Files  81 passed (81)
     Tests  995 passed | 3 skipped (998)
```

The whole corpus went unreplayed under a green run. fetch-depth: 0 was set and was
never the problem. From the checkout step of that same run:

```
[command]/usr/bin/git -c protocol.version=2 fetch --prune --no-recurse-submodules \
  origin +refs/heads/*:refs/remotes/origin/* +refs/tags/*:refs/tags/*
 * [new branch]        main                      -> origin/main
Switched to a new branch 'v13-main'
```

One local branch is created, the one being built. Every other branch is a
remote-tracking ref, so `git archive main` resolves in a working clone and names
nothing on CI.

## After, run 32151123787, commit 84d2370a

```
src/gates/corpus-replay.test.ts (7 tests) 375ms
Test Files  81 passed (81)
     Tests  1002 passed (1002)
```

No skips. The corpus replays remotely, and the four extra tests are the revision
resolver's own.
