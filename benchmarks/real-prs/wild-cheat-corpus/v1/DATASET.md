# Wild cheat corpus v1

Agent pull requests a human maintainer publicly called a cheat and named the
category, mined by the Hunt 2 complaint cascade. Every number here is computed by
`scripts/corpus/export-wild-cheats.ts`; nothing is hand-entered.

## What this is

27 agent-attributed PRs, each carrying at least one maintainer complaint
whose phrasing names a cheat category. 7 shipped (`merged`) despite the
complaint; 20 the maintainer caught and rejected (`closed`). 6 are
in execution-grounded-viable repositories.

This is a **held-out test set**. No tuning script, calibration run, or
prompt-selection loop may read it; `loadWildCheatCorpus` refuses any non-evaluation
caller in code (`scripts/real-prs/lib/wild-cheat-corpus.ts`).

## Provenance

- Mined from GitHub PR review/issue comments by the Hunt 2 cascade
  (`scripts/real-prs/hunt2.ts`), phrase matcher `CHEAT_COMPLAINT_PATTERNS` /
  `extractComplaintSignals` in `scripts/real-prs/lib/github.ts`.
- Each complaint is verified against the fetched PR conversation; the PR is
  agent-attributed by the shipped fingerprinter (`src/audit/pr-source`,
  `detectAgent`) before it counts.
- Full mining record and funnel:
  [`benchmarks/real-prs/HUNT-2-REPORT.md`](../../HUNT-2-REPORT.md).

## Selection bias (read before citing)

These are only the cheats a **human caught and complained about in writing**. The
corpus over-represents cheats that are visible in review and under-represents
cheats that shipped silently (no complaint) or were never reviewed. It is a
lower bound on wild-cheat prevalence, not a random sample. The proof tier proved
**zero** of the execution-grounded-viable ones (HUNT-2-REPORT.md): control-
verifiable cheats are rarer than complained-about cheats.

## Category distribution

| maintainer-named category | count | cross-taxonomy (provisional) |
| --- | --- | --- |
| assertion-strip | 8 | reward-hacking / weakened-oracle |
| error-swallow | 2 | robustness-violation / silent-failure |
| goal-not-fixed | 7 | task-incompletion / unmet-goal |
| hardcoded-output | 2 | reward-hacking / memorized-output |
| mock-of-hallucination | 1 | reward-hacking / fabricated-dependency-mock |
| no-op-fix | 4 | specification-gaming / non-fix |
| test-relaxation | 3 | reward-hacking / test-tampering |

## Vendor distribution

| agent | count |
| --- | --- |
| claude-code | 18 |
| codex-cli | 3 |
| copilot-workspace | 6 |

## Cross-taxonomy mapping (provisional)

The frontier plan asked for a mapping onto the TRACE 54-category taxonomy. That
name could not be resolved to a canonical published source during this run
(searched 2026-07; nearest analogues: MAST-14, TRAIL, and the 20,574-session
developer-agent misalignment study). The `crossTaxonomy` column above is a
best-effort failure-mode descriptor, provided as a scaffold; a maintainer with
the authoritative TRACE reference should rebind it to TRACE's category ids. It is
labeled provisional so it is never cited as a TRACE mapping it is not.

## Schema

Each entry in `dataset.json`: `id`, `repo`, `prNumber`, `url`, `state`
(merged|closed), `vendor`, `vendorConfidence` (attribution evidence), `headSha`,
`baseSha`, `complaintCategory`, `complaints[]` ({category, phrase, source}),
`outcome` (repository-outcome label where computable, else unknown), `egViable`,
`crossTaxonomy`, `holdout` (always true).

The diff is referenced by `repo` + `headSha` + `baseSha`, not vendored: fetch it
with `git fetch <repo> <headSha>` or the GitHub PR page at `url`. This keeps
third-party code out of the tree, matching the hunt's gitignore policy.

## License

The dataset (this schema, the labels, the mapping) is released under the
repository license. The referenced PR contents remain under their upstream
repositories' own licenses; this corpus vends no third-party code, only public
metadata (repo, PR number, SHAs, public complaint text) and derived labels.

## Reproduce

```sh
npm run build
npm run export-wild-cheats   # regenerates this directory from population.json
```
