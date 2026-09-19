# 0010. Move historical evidence payloads out of the tree, keep every digest, manifest and verifier in it

**Status:** proposed, 2026-09-15. Implementation is out of scope for the change that wrote this.

## Context

`docs/evidence` is 51,410,178 bytes of tracked content (49.03 MB) across 14,886 files, and
92.1 MB on disk once the filesystem's block allocation for 14,413 small payload blobs is
counted. The whole tracked tree is 103,710,198 bytes (98.91 MB) across 17,178 files, against
the 100 MB ceiling in `scripts/check-repo-weight.mjs`. Every dated directory under
`docs/evidence` is measured below, from what git tracks.

The August offload moved rendered review pages out of some bundles and, for a while, payload
blobs too. The blobs came back, because a bundle without its payloads fails its own verifier and
four of those bundles were cited as evidence that verifies; the rule since then is that a cited
bundle keeps everything it needs to verify from a clone. That rule is right and it is why the
tree is the size it is: 50 bundles, each carrying its ledger, its DAG, its payloads and a copy of
the verifier.

What a reader pays for is not the evidence but its bulk. The files that make a bundle
*checkable* are small: the manifest with the chain head and signature, `blobs.digests.json`
with the SHA-256 of every payload, and the verifier scripts. The files that make it *verifiable
in place* are large: the ledger, the DAG and the payloads. Invariant 4 requires offline
restoration and preserved formats; it does not require the bytes to sit in this tree, only that
their digests do and that restoring them is checkable.

## Decision

Move the bulk of every campaign older than the two most recent ones into a separate evidence
repository, and keep in this tree everything a reader needs to check that what comes back is
what was recorded. The alternative, git LFS, is rejected below.

**What moves.** Four kinds of file, from the five dated directories before 2026-09-11:
`ledger.jsonl`, `dag.json`, every file under `blobs/`, and `review.html`. Nothing is rewritten,
truncated or regenerated; each file moves byte for byte (invariant 2).

**What stays.** In every bundle directory: `manifest.json`, `blobs.digests.json`, `verify.mjs`,
`rederive.mjs` and, where present, `controller.mjs` and `attestation.dsse.json`, so the
directory a claim links to still exists, still names its chain head, still lists every payload
digest, and still carries the verifier that will check the restored bytes. Every markdown report,
every asciinema cast, the review-page screenshot, the shakedown logs, the mined patches and the
corpus JSON stay, because documents link to them directly and re-scoring reads them. The two most
recent campaigns, `2026-09-11/local-campaign` and the `2026-09-14` pilot report, stay whole.

**What is added.** One committed index, an `archive.json` at the root of `docs/evidence/`, listing
every moved file by its path in this tree, its byte length, its SHA-256, and the archive
repository commit that holds it. Restoration writes a file only where its bytes hash to the digest the index names, which is
the rule `scripts/restore-bundle-blobs.mjs` already applies to payloads. A bundle is then
checkable in three steps from a clone: restore, verify the restored bytes against the index, run
the bundle's own verifier. The index is the digest carrier for the moved files; the bundle's
`blobs.digests.json` continues to carry the payload digests, so the two agree or restoration
refuses.

## Exact sizes

Before, from `git ls-files` and file sizes on 2026-09-15:

| | bytes | MB | files |
| --- | ---: | ---: | ---: |
| tracked tree | 103,710,198 | 98.91 | 17,178 |
| `docs/evidence` | 51,410,178 | 49.03 | 14,886 |

What moves, by kind:

| kind | bytes | MB | files |
| --- | ---: | ---: | ---: |
| payload blobs (`blobs/*.json`) | 24,315,221 | 23.19 | 14,413 |
| `ledger.jsonl` | 5,705,275 | 5.44 | 50 |
| `dag.json` | 5,276,906 | 5.03 | 50 |
| `review.html` | 5,484,306 | 5.23 | 12 |
| **total** | **40,781,708** | **38.89** | **14,525** |

By dated directory:

| directory | bytes | MB | files |
| --- | ---: | ---: | ---: |
| `2026-08-18` | 10,901,084 | 10.40 | 1,902 |
| `2026-08-23` | 7,890,948 | 7.53 | 3,722 |
| `2026-08-24` | 3,543,141 | 3.38 | 575 |
| `2026-09-02` | 11,343,808 | 10.82 | 5,374 |
| `2026-09-04` | 7,102,727 | 6.77 | 2,952 |

After:

| | bytes | MB | files |
| --- | ---: | ---: | ---: |
| tracked tree | 62,928,490 | 60.01 | 2,653 |
| `docs/evidence` | 10,628,470 | 10.14 | 361 |

The 83 verifier copies stay and cost 1,696,217 bytes between them; that is the price of "verify
anywhere" and is not on the table. The `2026-09-05`, `2026-09-06` and `2026-09-07` directories
hold reports and corpus JSON only, so nothing in them moves.

Git history is unchanged by this: a full clone still downloads the moved bytes as history, and
rewriting history to drop them is not proposed. What a shallow clone downloads, what
`git ls-files` walks, and what every check over the tree reads is what shrinks.

## The `docs/claims.md` rows whose artifacts would move

Six rows cite a bundle whose ledger, DAG and payloads would move. The directories they link to
stay, holding the manifest, the digests and the verifier, so no link breaks; what changes is that
following the link to a verifying bundle needs the restore step first, which the row must say.

| row | artifacts that move |
| --- | --- |
| The tool completes real tasks and exports evidence of it | `evidence/2026-08-18/live-frontier/`, `evidence/2026-08-18/live-local/` |
| Local model selection is measured on the machine it runs on | `evidence/2026-09-02/calibration/`, `evidence/2026-08-23/calibration/` |
| A session runs several tasks against one workspace, and each turn is measured on its own | `evidence/2026-08-24/session/` |
| The audit chain is proven on a schedule, from a clean clone, in both directions | `evidence/2026-08-18/live-frontier` |
| The criteria are sealed before the loop, every pass is bonded, and a bundle re-derives its own verdicts | `evidence/2026-09-02/gates-bonded/` |
| The declared-file-set check blocks an out-of-set edit until an amendment is recorded | `evidence/2026-08-18/shakedown/bundles/task-08-file-set-amended` |

The fourteen bundles `scripts/check-cited-bundles-verify.mjs` holds to verifying from a clone
are all in the moving set: 34,694,647 bytes of them move and 4,282,563 bytes stay. Exempting
them from the move would leave the tree at about 95 MB and buy nothing, so they move too and
the check changes as described next.

## What `scripts/check-cited-bundles-verify.mjs` would need to change

Today it runs `node verify.mjs` inside each cited bundle directory and fails if any exits
non-zero. After the move that directory holds no ledger, so the same command would fail with
"ledger.jsonl missing", which is the wrong finding: nothing was tampered with, the bytes are
elsewhere.

1. Before verifying, restore each cited bundle from the archive repository at the commit the
   index pins, into a scratch directory outside the tree, writing each file only where its bytes
   hash to the digest the index names. The check never writes into
   `docs/evidence` itself.
2. An archive that cannot be reached, a pinned commit that is not there, or a restored file whose
   digest disagrees is a failure with that reason named, never a skip: the check exists because
   cited bundles once stopped verifying and nothing noticed, and a silent skip would put that back.
3. Run the bundle's own `verify.mjs` over the restored directory, exactly as now, and keep the
   `local-campaign` archive verification unchanged since that campaign does not move.
4. Refuse an index entry for a file that is still tracked, and a moved file that has no index
   entry, so the tree and the index cannot disagree about where a byte lives.

Three neighbours change with it. `scripts/restore-bundle-blobs.mjs` gains the archive as a
second source beside the session store, under the same digest rule. `scripts/offload-bundle-blobs.mjs`
gains the four kinds above and writes the index entry before removing each file, the same
order it already uses for payloads, so a process killed between the two leaves the file and an
extra index entry rather than a gap. `.github/workflows/nightly-proof.yml` restores
`2026-08-18/live-frontier` the same way before proving it. `scripts/check-doc-paths.mjs` needs no
change: no document links a file that moves, and every linked directory still exists.
`scripts/check-repo-weight.mjs` keeps its 100 MB ceiling until the move has landed, and only
then is lowered to where it catches the bulk coming back; lowering it first would make the tree
red for the reason this decision exists.

## Why a separate repository rather than git LFS

LFS leaves a pointer file in this tree for every moved file, and a pointer is not a ledger.
`verify.mjs` run over a pointer fails on the first byte with an error that says nothing about
LFS, and `git ls-files` still lists 14,525 paths, so the file-count cost stays. The tracked
weight then depends on whether the LFS smudge filter ran at checkout, which makes
`check-repo-weight.mjs` answer differently on two clones of the same commit. GitHub's LFS
bandwidth allowance is also a quota on how often the evidence can be checked from a fresh
clone, which is exactly the operation the checks above perform on every push. A second
repository has none of those properties: paths that move are absent here and present there,
the index says which is which, and restoration is an ordinary clone at a pinned commit.

## What this does not buy

It does not make the evidence smaller, older, or less binding; every record stays reachable and
every claim stays checkable, one step further away. It does not reduce the history a full clone
downloads. And it moves a trust boundary that has to be named: the archive repository's
integrity rests on the digest index committed here, not on the archive. A reader who trusts
this tree and restores from the archive gets bytes this tree named or gets a refusal.

## Addendum, 2026-09-18: derived artifacts are packed in the tree

This decision is still a proposal and nothing above has been built. What landed instead is the
part that needed no second repository. The tree reached 99.8 MB with the reach-pressure run, and
78 run transcripts and 12 rendered review pages, which no verifier and no check reads, were
10.2 MB of it. `scripts/evidence-pack.mjs` packs tracked derived artifacts losslessly into the
`utf8-file-map-brotli` format this repository already uses, with a digest per original, and
`npm run checks` verifies every pack. That took the tree to about 90.5 MB with every cited bundle
still verifying from a clone, and `scripts/check-repo-weight.mjs` now requires 6 MB of headroom.

It changes one row of the table above: `review.html` no longer needs to move, because it no longer
weighs anything. Ledgers, DAGs and payloads are what is left, they are what a bundle is, and
moving them is still what this document proposes.
