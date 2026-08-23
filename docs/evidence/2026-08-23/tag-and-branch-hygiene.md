# Tag and branch hygiene, 2026-08-23

The 08-18 run deferred the `schema-v1` decision deliberately and left every local-only ref
where it was. This closes both.

## `schema-v1`: kept, pushed, and documented

The 08-17 state report lists it as dangling: annotated, pointing at `79c9c856`, contained by
neither `main` nor `v13-main`. That is still true, and the reachability check is stronger than
"no branch contains it":

```
$ git tag | while read t; do git merge-base --is-ancestor 79c9c856 "$t^{commit}" && echo "$t"; done
schema-v1
$ git branch -a --format='%(refname:short)' | while read b; do git merge-base --is-ancestor 79c9c856 "$b" && echo "$b"; done
(nothing)
```

The tag is the only reference to that commit anywhere in the repository. Deleting it would not
tidy a listing, it would make the commit unreachable and hand it to the next `git gc`.

What it tags: `feat(v8): scaffold module skeleton (Phase 0)`, 2026-05-05, by Brad Kinnard. It
introduced the v8 module skeleton and, with it, `schema-v1:src/contract/schema/v1.json`, the
JSON Schema for the v8 contract format, plus its 199-line test. That is git's own spelling of
a path at a revision, and it is written that way because the file lives at that commit and
nowhere in this tree. The tag message is "Schema v1 commit". The
schema is the reason the tag exists: it names the version of a format rather than a release of
a product, which is why it never sat on a branch.

**The decision is to keep it, and the close is to make it durable and documented rather than
dangling.** It was local-only, so the sole pointer to that commit lived on one laptop. It is
now on origin:

```
$ git push origin schema-v1
 * [new tag]           schema-v1 -> schema-v1
$ git ls-remote --tags origin | grep schema-v1
aa0b6a39e893fa3285001cf0066d3e2db5e09be3	refs/tags/schema-v1
79c9c856e4d45dc2829db6d562a4a994a87f5a95	refs/tags/schema-v1^{}
```

Nothing in the v13 tree reads it. It is history, kept because this project's whole argument is
that a record is worth more than a tidy summary of one.

## Every other local-only tag

`phase-5-complete` and `phase-6-complete` are local-only and, unlike `schema-v1`, are not the
only pointers to anything: both commits are reachable from `main`, from `dogfood/tamper-demo`,
and from the `v10` tags onward. They are v8-era progress markers on the v12 lineage, they name
nothing the v13 tree or its consumers read, and pushing them would add two refs to a public
listing that mean nothing to anyone reading it.

**Intentionally local, for that reason.** Recorded here rather than left to be rediscovered:

| Tag | Commit | Reachable from |
| --- | --- | --- |
| `phase-5-complete` | `d237e740` | `main`, `dogfood/tamper-demo`, `phase-6-complete`, `v10.0.0` onward |
| `phase-6-complete` | `7a9d0be3` | `main`, `dogfood/tamper-demo`, `v10.0.0` onward |

Every other tag in the repository is already on origin, `v13.0.0` and `v12-final` included,
both pushed in this run.

## Branches

Each was tested with `git merge-base --is-ancestor <branch> v13-main` and
`git rev-list --count <branch> ^v13-main`, and the hashes were written down before anything
was deleted.

### Ancestors of `v13-main`, deleted

Nine branches, all fully contained in `v13-main`, so nothing was lost with any of them.

| Branch | Was at | Tip |
| --- | --- | --- |
| `crossfire-h3` | `1303aa2c` | Scope the scrub property test to its own artifacts |
| `loop/shakedown` | `fd81acac` | Close the two new scrub gaps instead of documenting them |
| `redteam/loop/lap-1` | `635140f4` | red-team loop lap 1: no fix pass, gates baseline |
| `redteam/loop/lap-2-attack` | `dd92b033` | red-team lap 2: argv spawn and scrubbed-env findings |
| `redteam/v13-evidence-guarantees` | `b6164cd7` | Say in the invariants what the harness now actually does |
| `redteam/v13-pass2-throwaway` | `c9239e18` | Point the derivation residual at the section that names it |
| `redteam/v13-pass3-throwaway` | `673148c8` | Check the two claim resolvers against each other |
| `redteam/v13-pass4-throwaway` | `d5655e94` | Add fixture laps for a dry run of both routes |
| `v13` | `d9053546` | Stop the export scrub gate from reading a metric as a secret |

`git branch -d` was used rather than `-D`, so git would have refused any of them that was not
merged. None was refused.

### Non-ancestors, kept, and now on origin

Four branches carry commits `v13-main` does not. Three of them were local-only, so those
commits existed on exactly one machine. They are pushed rather than deleted, because the run's
rule is that a non-ancestor carrying unique commits is recorded before anything happens to it,
and the cheapest way to record a commit is to keep it.

| Branch | Unique commits | Now | Why it matters |
| --- | --- | --- | --- |
| `crossfire-converge-01` | 2 | pushed | a two-round convergence test of the crossfire loop |
| `crossfire-fuzz-01` | 6 | pushed | the ReDoS refusal and two fuzz-harness false negatives, in the order they were found |
| `redteam/loop/lap-1-attack` | 1 | pushed | `cdbe9651`, which is where the 08-18 run recovered the pass5 probe from after it was found missing |
| `crossfire-fuzz-02` | 10 | already on origin | a superset of `crossfire-fuzz-01` plus the corpus-copy fix |

`redteam/loop/lap-1-attack` is the one worth naming twice. The 08-18 run found a dangling
pointer in `redteam/pass5` and restored the file byte-exact from that branch. Deleting it would
have removed the provenance of a restored artifact while leaving the artifact in place, which
is the shape of defect this project exists to refuse.

### Left alone

| Branch | Why |
| --- | --- |
| `main` | 1269 commits `v13-main` does not have: the whole v12 auditor lineage. Already on origin, and `v12-final` tags its tip |
| `dogfood/tamper-demo` | 979 unique commits on the v12 lineage, already on origin, and the tamper demonstration reads from it |

## After

    $ git branch
      crossfire-converge-01
      crossfire-fuzz-01
      crossfire-fuzz-02
      dogfood/tamper-demo
      main
      redteam/loop/lap-1-attack
    * v13-main

Every one of those exists on origin. Nothing local-only is left except the two phase tags
above, which are named here as intentionally local.
