# Claims and what backs them

Every public claim this project makes, mapped to the artifact that shows it. The rule is
that a claim without an artifact does not get made, and the second half of this file is the
list of things the tree cannot back and that no README, release note or page may say.

Paths are relative to this file's directory.

## What is claimed

| Claim | Backing artifact |
| --- | --- |
| Every green verdict is harness-computed, and the model cannot render one | `../src/evidence/claim.ts` with `../src/evidence/predicate.ts`, and the 49 cases in `../src/evidence/redteam-adversarial.test.ts`. Shown happening at scale in `evidence/2026-08-18/shakedown/results.md`: across ten real tasks the harness rendered 11 claims VERIFIED and refused 42, in four distinct ways, including one `predicate-kind-mismatch`. None aborted a run |
| A one-byte change to a ledger record is caught | `evidence/2026-08-18/tamper-demo/README.md`: the same bundle verified and tampered, exit 0 and exit 1, with `flip-one-byte.mjs` to reproduce it from the committed bundle |
| A bundle carries its own verifier and needs nothing from this repo | `evidence/2026-08-18/live-tasks.md`: both bundles verified by their own embedded `verify.mjs`, run from outside the repository with no install. What this does **not** yet show is a machine that has never seen the repo; that is `evidence/2026-08-18/clean-container-verification.md`, recorded NOT-RUN |
| The tool completes real tasks and exports evidence of it | `evidence/2026-08-18/live-frontier/` and `evidence/2026-08-18/live-local/`, two bundles from two models, 42 and 60 records, both verifying |
| Bundles are signed with a key from the OS keychain | both manifests carry `"keySource": "keychain"`, and both verifier transcripts in `evidence/2026-08-18/live-tasks.md` report `ed25519, keychain key` |
| A run draws a live screen a person can drive, and a keystroke has no route to a verdict | `../src/tui/view-state.ts` and `../src/tui/session-view.ts` are separate types with separate reducers, and `../src/tui/view-state.test.ts` asserts across every view action that no field of the first shares a name with a field of the second and that no value it can produce reads as a verdict. `evidence/2026-08-23/interface.md` for the screen, the keymap and the config surface, with the captured frames in `evidence/2026-08-23/interface-frames.txt` and a playable recording in `evidence/2026-08-23/interface.cast` |
| The plain-line stream a pipe and CI read is unchanged by the interactive work | `../src/tui/fixtures/plain-lines.txt`, captured before any of it was written, and `../src/tui/plain-lines.test.ts`, which asserts the rendering of a fixed event sequence is byte-identical to it |
| A confirmation answered on the screen reaches the chokepoint intact | `../src/tui/confirmation-path.test.ts` drives a keystroke through the dispatcher and the queue into `createToolChokepoint`, in both directions, and asserts the tool ran or did not |
| The evidence panel opens a harness-computed path, by argv, and says verified only where the verifier ran | `../src/tui/open-path.ts` and `../src/tui/evidence-panel.ts`, with `../src/tui/evidence-panel.test.ts`: a path tagged anything but `harness` raises, a hostile path travels as one argument with no shell, the opener environment carries no name that decides what a process loads, and the panel reads "not verified in this run" with the command unless the embedded verifier exited 0 here |
| Adversarial passes, with the closures locked as regression tests | `../redteam/pass2` through `../redteam/pass7`, `../src/evidence/redteam-adversarial.test.ts`, and the accounting in `../redteam/loop/state/lap-accounting.jsonl` |
| Eight untrusted boundaries are fuzzed, and the harnesses are not blind | `../fuzz/README.md` for the eight, `security-coverage.md` for the instrumented-versus-blind coverage numbers, and `evidence/2026-08-18/fuzz-findings-replay.md` for the preserved crash artifacts and their disposition |
| Local model selection is measured on the machine it runs on | `evidence/2026-08-18/hardware-select.md` for the probe, `evidence/2026-08-18/calibration-report.md` and `evidence/2026-08-18/calibration/` for 60 runs of one model with distributions rather than averages |
| Known limitations are documented rather than hidden | `build-guide.md` section 7.1 for the four residuals, the null results in `security-coverage.md`, and the NOT-RUN entries in `evidence/2026-08-18/run-report.md` |
| Behaviour over ten consecutive real tasks | `evidence/2026-08-18/shakedown/pass-criteria.md`, written and committed before anything ran, and `evidence/2026-08-18/shakedown/results.md`: eleven bundles, all verifying, none of the six stated failure conditions met |
| The declared-file-set check blocks an out-of-set edit until an amendment is recorded | `evidence/2026-08-18/shakedown/bundles/task-08-file-set-amended`, where the gate blocked three times and the run went green only after an amendment with a reason reached the ledger |

## What may not be said

Verbatim, because each of these has been tempting at some point in this project's history.

- **"Seven red-team laps."** The loop ledger records one completed lap. Six of the seven
  pass directories were human-driven work outside the driver, which
  `../redteam/loop/state/lap-accounting.jsonl` sets out. Say "adversarial passes with
  closures locked as regression tests".
- **Any regulatory or standards date.** No EU AI Act article, no prEN 18229-1, no
  ISO/IEC 24970, no compliance deadline, in the README, on any page, or in any release note.
  The build guide's own instruction is to re-verify all three before they appear anywhere,
  and they have not been re-verified.
- **"Fully secure", or any unbounded security claim.** The honest naming is known-pattern
  scrubbing, not secret removal, and there is a four-character floor under it. Zero crashes
  at a given fuzz budget is evidence, not proof.
- **Any number the tool did not measure locally.** No benchmark, no comparison against
  another agent, no throughput figure carried over from a model card. The shortlist's size
  and memory figures are curated estimates and the select report says so itself.
- **Any suggestion the four judge-shaped residuals are closed.** They are open, they ship as
  documented limitations, and each is a permanent case in the adversarial suite asserting
  the gap as it stands.
