# False-positive regression registry

Every diagnosed gate false positive becomes a permanent entry here. CI fails if a
gate trigger would still fire on any entry (`npm run fp-registry:check`, wired into
`.github/workflows/ci.yml`). This is the ratchet: once an FP class is diagnosed and
neutralized, it can never silently regress.

## Entry schema

One JSON file per entry, beside its committed PR diff:

| field | meaning |
|---|---|
| `id` | stable slug, also the diff filename stem |
| `pr` | `owner/repo#N` the FP fired on |
| `headSha` / `baseSha` | the PR's pinned commits |
| `firedTrigger` | the block-trigger kind the gate wrongly raised |
| `category` | the cheat category the finding carried |
| `findingFiles` | the tampered files the proof pointed at |
| `diagnosis` | why it is a false positive, in prose |
| `disposition` | `neutralized-by-refuter` (a refuter now drops it) or `live-fp` (not yet fixed; it flows into the block-eligibility denominators and can demote its trigger) |
| `refuter` | for a neutralized entry, the refuter that drops it (today: `coverage-relocated`) |
| `diffFile` | the committed unified diff the check replays against |
| `recordRef` / `source` | provenance in the repo |

## What the check enforces

For a `neutralized-by-refuter` entry, the checker replays the named refuter over
the committed diff and every `findingFile`, and asserts it fires (so the gate's
proof would downgrade rather than block). If the refuter no longer fires, the
entry would gate again: the check exits non-zero and CI goes red. A `live-fp`
entry is not expected to be neutralized; instead it contributes a confirmed false
positive to its trigger's revert-calibration denominator
(`block-eligibility.json`), which auto-demotes a self-certifying trigger to
advisory when its Wilson-95 lower bound drops below the bar.

## Entries

- **jeduden-mdsmith-232** (`test-tamper-proven`, `coverage-relocated`,
  neutralized): the gate's one known coverage-moving false-positive class. See
  `benchmarks/real-prs/hunt7/HUNT-7-REPORT.md` for the full autopsy.
