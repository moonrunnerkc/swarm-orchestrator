# Miner definitional tightening: regression, both directions

The last review sitting was 2 real in 24. The tightening restores the definition the
loose miner had drifted from: a maintainer complaint comes from a **human other than
the PR author**. Two exclusions, both definitional (not filter tuning):

1. **Self-comments excluded.** A comment by the PR author cannot satisfy "a maintainer
   publicly called it a cheat" (the author describing their own change, even
   critically, is not an independent maintainer catching a cheat).
2. **Bot authors excluded.** Account type `Bot`, the `[bot]` suffix, and the GitHub
   Copilot review surface (which authors as bare `Copilot`). A bot is not a human
   maintainer.

Both live in the miner (`mine-complaints.ts` + `isMaintainerComplaintEntry` /
`isBotAuthor` in `lib/github.ts`) and are documented in `DATASET.md` provenance.
Regenerate the numbers below with `tightening-regression.js` over the committed input
lists.

## Negative direction: the last package's 24 as a labeled noise fixture

Every candidate that used to pass intake, re-classified by the role of its cheat-phrase
match (`tightening-package24.json`):

| measure | count |
| --- | --- |
| old intake hits (any phrase match) | 24 |
| tightened intake hits (a non-author, non-bot human matched) | **7** |
| excluded: self-only | 10 |
| excluded: bot-only | 5 |
| excluded: self-and-bot | 2 |

**17 of 24 excluded, every one a self-comment or a bot review.** The tightened intake
admits 7: the 2 entries the maintainer folded plus 5 legitimate-on-the-merits entries
(triton-lang/triton#10202, import-js/eslint-plugin-import#3230, and peers) that carry a
genuine independent-human complaint. Those 5 **pass intake by design and die at human
review** (a real reviewer weighed in, but the diff is legitimate); the tightening is
not meant to catch them, the human fold gate is. This is the noise taxonomy from the
last sitting, now enforced at intake: the miner no longer surfaces self-descriptions or
Copilot reviews as maintainer complaints.

## Positive direction: do the folded corpus entries still pass?

The task asked to verify none of the 29 folded entries was authored by a bot or the PR
author. The honest check (`tightening-corpus29.json`):

| measure | count |
| --- | --- |
| entries | 29 |
| still admitted under the tightened bar | **9** |
| excluded: self-only | 13 |
| excluded: bot-only | 6 |
| fetch error (deleted PR) | 1 |

**The 2 entries folded this line of runs pass** (vlebo/ctx#24 human, elixir-nx/nx#1685
human), so this run's own folds are clean. But **19 of the inherited 27 (Hunt 2's,
mined under the loose filter) would not pass the tightened bar**: their cheat-phrase
match, in the current conversation, is self-authored (13) or bot-authored (6, several
Copilot reviews, e.g. outline/outline#12197's complaint is a bot). This is a finding
about the inherited corpus, not an action taken on it:

- **The frozen corpus is not modified.** v1 and v2 stand; deleting entries is out of
  scope and a halt condition. The finding is reported so a future run can re-verify the
  inherited corpus under the tightened bar.
- **Two honest caveats.** (a) Temporal drift: this re-fetches today's conversation, not
  the thread Hunt 2 matched months ago, so an edited or deleted comment can shift a
  classification. (b) The task's rule excludes every PR-author comment, which catches
  solo-maintainer repos where the owner opened an agent PR and self-reviewed it; whether
  that is "a maintainer complaint" is a definitional call the task made (exclude it).

## Package noise rate: 13% -> 3.3%

The committed negative-control set (30 agent PRs with non-cheat complaints), through the
tightened intake (`tightening-negctrl.json`):

| | old | tightened |
| --- | --- | --- |
| benign threads reaching the package | 4 / 30 (13%) | **1 / 30 (3.3%)** |

3 of the 4 old false-positive trips were self-authored or self-and-bot; the tightening
removes them. The maintainer's expected review noise per 30 benign threads falls from
13% to 3.3%.

## Reproduce

```sh
node dist/scripts/real-prs/mining-verification/tightening-regression.js \
  --input benchmarks/real-prs/mining-verification/tightening-input-package24.json \
  --out benchmarks/real-prs/mining-verification/tightening-package24.json --label package24
# and the corpus29 / negctrl input lists likewise
```
