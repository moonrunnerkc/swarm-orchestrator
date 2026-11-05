# 17.0.0 evidence before the sealed-set runs (2026-11-05)

What was measured while the 17.0.0 changes were built, each item with what it can and cannot show.
The sealed-set runs themselves are in `../2026-11-04-comparison/README.md`, "17.0.0".

## The check author on the real wording (`authoring-trial/`)

The check-authoring stage alone, gemma4:31b on Ollama, on clones of pubprep and ironroot at the
November 4 bases, with what it wrote run against the reference patch, Claude Code's patch and
Swarm's November 4 patch. One trial each.

- `pubprep-1.summary.json`: the first trial. Its test imported `../src/index.js`, which pubprep does
  not have, so every patch failed it, the reference included. That led to the definitions list,
  the import-based example choice and the rejection of an unrelated import.
- `pubprep-2/`: fails at the base; passes the reference and Claude Code's patch (8 of 8); fails
  Swarm's patch on "handles repeated reviewers and maintains the fixed order".
- `pubprep-7/` to `pubprep-9/`: after rc.10's pubprep run read incomplete where the judge read
  complete, each authored test was also sealed and run on the reference patch by `swarm-verify
  verify` in its container (`container-reference.txt`; `trial-17/container-judge.sh`), the way
  the verdict runs it. pubprep-7 (told the tree is uncommitted) passed both references and
  Claude Code's patch on this machine, but in the container its main() case failed: it set a
  short fake key, and only this machine's `claude` binary had kept main() from checking it.
  pubprep-8 (told about the container and to mock what the repository's tests mock) held its
  main() cases there, but three cases gave `expect.stringMatching` to `toThrow` and failed
  everywhere. pubprep-9 (that misuse refused from the source): the first attempt was refused for
  it, the second passed the reference in the container, 9 of 9, and both patches on the host, and
  failed Swarm's November 4 patch.
- `ironroot-1/`: eight claims, all failing at the base, all holding on the reference and Claude
  Code's patch; the four "falsification.py lacks" claims fail on Swarm's copy. These were text
  claims; the author now writes symbol claims.

## Prefill (`prefill/`)

The same 14 recorded replies (feature-pubprep, session 20261105T075907-93df60, turns 1 to 14)
through the November 4 loop (3e2192c27) and the 17.0.0 loop (7ea9ca954), every prompt each one
sent captured (`capture.sh`, `capture-stub.mjs`), then each sequence sent in order to Ollama's
`/api/chat` with one output token (`measure.mjs`), gemma4:31b at a 65,536-token context.

| Loop | Characters sent | Characters after the prefix shared with the turn before | Prefill reported by Ollama, 14 turns |
| --- | --- | --- | --- |
| November 4 | 303,284 | 200,692 | 205,842 ms |
| 17.0.0 | 339,077 | 113,573 | 109,059 ms |

The 17.0.0 prompts are longer in all and repeat more of themselves from turn to turn. Ollama's
`prompt_eval_count` on this version counted the whole prompt each turn, so the reported duration,
not the count, is the measure of what its cache saved. One model, one sequence, one machine.

## Selection with Rapid-MLX up (`selection/`)

The installed 17.0.0 candidate's resolver, `--model auto` with `http://localhost:8000/v1`
configured, Rapid-MLX serving qwen3.8:27b: the endpoint's model was probed (ready) and ranked with
the Ollama models, and gemma4:31b was chosen by this machine's record (86% of 14 finished tasks
complete; qwen3.8:27b 2 of 14). Rapid-MLX was then stopped: see the sealed-set runs for why.

## Replays of recorded sessions (`replays/`)

Each recorded session's model replies, in order, served to the 17.0.0 loop by a stub, the check
author live on Ollama (gemma4:31b), on a fresh clone at the session's base, checks on the host
(`replay.sh`, `replay2.sh`, `replay-stub.mjs`). A recorded reply does not change with what the new
loop shows it, so a replay shows how the new loop ends a run the old one ran, not what a live model
would do next.

| Replay | Session | Model | Recorded turns | Recorded stop | Replayed turns | Replayed stop | Reason given | Author |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h2-e94107 | 20261101T142202-e94107 | qwen3.8:27b | 15 | no-progress | 15 | no-progress | the same command printed the same result 3 turns running; R1's independent check fails at the base, and the tree was never changed | fix: test |
| h2-4e0ccd | 20261101T203914-4e0ccd | qwen3.8:27b | 18 | no-progress | 15 | no-progress | 3 turns changed neither the tree nor any check's result; R1 still fails | fix: test |
| t6-76ab1e | 20261103T213819-76ab1e | gemma4:31b | 25 | no-progress | 9 | no-progress | R1 still fails: tracemantle/history/history_io.py defines load_ledger: no file there | refactor: 18 claims |
| t6-6662f6 | 20261103T231418-6662f6 | gemma4:31b | 19 | no-progress | 13 | no-progress | the same, on the same claim | refactor: 18 claims |
| fixpick-a99a49 | 20261104T043531-a99a49 | gemma4:31b | 20 | complete | 11 | no-progress | R1 still fails: its authored test fails | fix: test |
| fixpick-41553d | 20261104T051054-41553d | gemma4:31b | 45 | no-progress | 14 | no-progress | R1 still fails: its authored test fails | fix: test |
| claimcheck-8f8758 | 20261103T222355-8f8758 | gemma4:31b | 60 | step-budget | 8 | no-progress | R1 still fails: its authored test fails | fix: test |
| claimcheck-3d4f21 | 20261103T235146-3d4f21 | gemma4:31b | 60 | step-budget | 25 | no-progress | R1 still fails: its authored test fails | fix: test |

What the replays found, each fixed in a commit of its own before the sealed-set runs:

- **fixpick-a99a49** was recorded complete (the fix commit's sealed test failed at the base and
  passed). Replayed, the authored test still failed: it built `ParsedSkill` without its
  frontmatter, so the code raised `AttributeError` before any assertion, at the base and on any
  correct fix. A fix's authored check that only raises is now rejected (ed773187a).
- **t6-76ab1e, t6-6662f6**: the authored claims named `tracemantle/history/`, after the wording,
  where the package is under `src/`; no correct move could satisfy them. Such a claim is now
  rejected (the commit after ed773187a). These two replays ran before that fix.
- The stop reason named "its authored test fails:" and nothing after; it now carries the first
  line that names the failure (ed773187a). The rows above ran before it.
- Three replays were first lost to the stub (Node's `fetch` gave up after five minutes on a long
  author call) and one to the verifier (Go's read-only module cache on removal, fixed in swarm-verify
  2.1.0-rc.5); they were rerun. A third t6 session (20261104T060822-ad6089) was not rerun, to keep
  the machine for the sealed-set runs.
- The h2-e94107 session never changed the tree; replayed, nothing measured an edit, so the run ended
  where it did before, now naming R1's check failing at the base.

## Refused edits (`replays/refusals.ts`)

Every refused edit of the November 4 runs, replayed against its file rebuilt from the base and the
accepted edits before it: 13 refusals, all correct (8 SEARCH parts holding lines the file never had,
4 joining a two-line signature, 1 matching two identical blocks). None led to a matcher change; the
refusal now shows the file's closest lines.
