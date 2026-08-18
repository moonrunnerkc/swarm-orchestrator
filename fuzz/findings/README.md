# Preserved crash artifacts

Each `.input` here is a byte-exact input that made a harness fail, kept so the failure stays
replayable after the fuzzer that found it is gone. Replay one with:

    npx jazzer fuzz/<harness>.fuzz.cjs fuzz/findings/<file>.input --timeout 5000 -- -runs=1

These are **not** corpus seeds. `fuzz/smoke.mjs` runs every file in `fuzz/corpus/<harness>/`
against its harness and fails the build on a throw, so a known-failing input kept there would
turn `npm run fuzz:build` permanently red and stop reporting anything new.

They are not unguarded either. `src/evidence/scrub.test.ts` reads every `scrub-*.input` in
this directory and asserts the invariant 9 property against it, so a regression on any of
them fails `npm test`, and the count assertion there fails if one goes missing.

## Status

All five are closed, replayed against the tree at 7ffea2cf on 2026-08-18. The transcript is
`docs/evidence/2026-08-18/fuzz-findings-replay.md`.

| Input | What it found | Closed by |
| --- | --- | --- |
| `scrub-dispatch-flip.input` | scrubbing twice differed from scrubbing once: a control byte makes a payload unparseable, so the text arm ran, and removing that byte inside a redacted span makes the result parse, so the next read took the structural arm | `da7b9794` |
| `scrub-marker-in-key.input` | a redaction marker spells "credential", so writing one into a key made that key credential-bearing on the next pass | `da7b9794` |
| `scrub-name-separator.input` | `wordsOf` splits a name on any non-alphanumeric run, so `api/_key` was a credential to the parser and invisible to the regex | `da7b9794` |
| `scrub-overlapping-spans.input` | overlapping spans resolve by keeping the earliest, which left what the later one covered unexamined until the replacement shortened the text around it | `da7b9794` |
| `scrub-nested-multibyte-key.input` | `scrubText` redacted nothing while `findKnownSecrets` reported `credential-assignment` on that same unchanged output: the write-time scrub and the export scan disagreeing about one payload, which invariant 9 says cannot happen | `da7b9794` |

`da7b9794` closed all five. It introduced the first four itself, as artifacts of faults it
found and fixed in the same change, which is why they were never written up here. It closed
the fifth by making both sites dispatch the same way and running the dispatch to a fixpoint,
since scrubbing can change which arm the next reader takes.

## How the fifth was checked

A disagreement is closed when the two sites agree on the bytes, so the check is a direct
A/B rather than an absence of crashes. Building `da7b9794~1` in a detached worktree and
running both against the preserved input:

    at da7b9794~1   scrubText redactions []                     export scan ["credential-assignment"]   DISAGREE
    at v13-main     scrubText redactions ["credential-field"]   export scan []                          AGREE

The class is closed, not just the instance. An astral character in the outer key, the same
at three levels of nesting, a BMP Cyrillic character in that position, and a single level of
nesting all agree the same way.
