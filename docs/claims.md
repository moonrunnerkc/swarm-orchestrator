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
| A bundle carries its own verifier and needs nothing from this repo, including on a machine that has never seen it | `evidence/2026-08-23/clean-container-verification.md`: the committed `live-frontier` bundle copied into a `node:24` container with no network and no mount of this repository, verified there (exit 0), and the same bundle one byte later refused there (exit 1), with the image digest and both transcripts. `evidence/2026-08-18/live-tasks.md` is the weaker earlier statement, from outside the repository on the machine that built it |
| The tool completes real tasks and exports evidence of it | `evidence/2026-08-18/live-frontier/` and `evidence/2026-08-18/live-local/`, two bundles from two models, 42 and 60 records, both verifying |
| Bundles are signed with a key from the OS keychain, and say so when they were not | both manifests in `evidence/2026-08-18/live-tasks.md` carry `"keySource": "keychain"` and both verifier transcripts there report `ed25519, keychain key`. Where the keychain holds no usable key the run signs with a per-run key, prints which of the three keychain failures happened, and the manifest records `keySource: ephemeral`: `evidence/2026-08-23/installed-package-run.md` and `evidence/2026-08-23/calibration-report.md` are both from a machine whose entry is not a key, and both say so. `../src/evidence/signing.ts` with `../src/evidence/signing.test.ts` |
| A run draws a live screen a person can drive, and a keystroke has no route to a verdict | `../src/tui/view-state.ts` and `../src/tui/session-view.ts` are separate types with separate reducers, and `../src/tui/view-state.test.ts` asserts across every view action that no field of the first shares a name with a field of the second and that no value it can produce reads as a verdict. `evidence/2026-08-23/interface.md` for the screen, the keymap and the config surface, with the captured frames in `evidence/2026-08-23/interface-frames.txt` and a playable recording in `evidence/2026-08-23/interface.cast` |
| The plain-line stream a pipe and CI read is unchanged by the interactive work | `../src/tui/fixtures/plain-lines.txt`, captured before any of it was written, and `../src/tui/plain-lines.test.ts`, which asserts the rendering of a fixed event sequence is byte-identical to it |
| A confirmation answered on the screen reaches the chokepoint intact | `../src/tui/confirmation-path.test.ts` drives a keystroke through the dispatcher and the queue into `createToolChokepoint`, in both directions, and asserts the tool ran or did not |
| The evidence panel opens a harness-computed path, by argv, and says verified only where the verifier ran | `../src/tui/open-path.ts` and `../src/tui/evidence-panel.ts`, with `../src/tui/evidence-panel.test.ts`: a path tagged anything but `harness` raises, a hostile path travels as one argument with no shell, the opener environment carries no name that decides what a process loads, and the panel reads "not verified in this run" with the command unless the embedded verifier exited 0 here |
| Adversarial passes, with the closures locked as regression tests | `../redteam/pass2` through `../redteam/pass7`, `../src/evidence/redteam-adversarial.test.ts`, and the accounting in `../redteam/loop/state/lap-accounting.jsonl` |
| Eight untrusted boundaries are fuzzed, and the harnesses are not blind | `../fuzz/README.md` for the eight, `security-coverage.md` for the instrumented-versus-blind coverage numbers, and `evidence/2026-08-18/fuzz-findings-replay.md` for the preserved crash artifacts and their disposition |
| Local model selection is measured on the machine it runs on | `evidence/2026-08-18/hardware-select.md` for the probe, and `evidence/2026-08-23/calibration-report.md` with `evidence/2026-08-23/calibration/` for 180 runs of three models with distributions rather than averages, which is the first calibration here that ranks a pick against anything. `evidence/2026-08-18/calibration-report.md` is the earlier one, 60 runs of a single model, superseded and left in place |
| Known limitations are documented rather than hidden | `build-guide.md` section 7.1 for the four residuals, the null results in `security-coverage.md`, and the NOT-RUN entries in `evidence/2026-08-18/run-report.md` |
| Behaviour over ten consecutive real tasks | `evidence/2026-08-18/shakedown/pass-criteria.md`, written and committed before anything ran, and `evidence/2026-08-18/shakedown/results.md`: eleven bundles, all verifying, none of the six stated failure conditions met |
| The packaged tool installs from its tarball and runs a task end to end, with nothing of this repository beside it | `evidence/2026-08-23/installed-package-run.md`: the 13.1.0 tarball installed into an empty directory, two tasks against a workspace it had never seen, recorded in `evidence/2026-08-23/live-task.cast` and `evidence/2026-08-23/open-evidence.cast`. One goes green and one escalates at the file-set gate citing its ledger record; both bundles verify from outside both directories, and the panel reports `open exited 0` rather than reporting that it opened something |
| The package on the registry is the artifact this repository built, and carries a signed statement saying so | `evidence/2026-08-24/registry-publish.md`: `npm install -g swarm-orchestrator` serves 13.1.3, published by CI run `32751820534` from tag `v13.1.3`. The shasum the registry serves is the one that run's `npm pack --dry-run` printed before the publish step, and `npm audit signatures` reports the SLSA provenance attestation verified from a clean install. It ties the tarball to this repository, this commit and that run, and it says nothing about whether the code is correct |
| The project page cannot state a claim this table does not make | `../scripts/build-site.mjs` generates the page from this file: the claims come from the rows above, the struck-through list comes from the section below, and the version comes from `../package.json`. `../scripts/build-site.test.mjs` asserts every row reaches the page, that every forbidden phrase reaches it too, that a path the repository does not track is left as text rather than linked to a 404, and that the only verdict the page renders is the refusal it quotes |
| A session runs several tasks against one workspace, and each turn is measured on its own | `evidence/2026-08-24/session.md`: three tasks typed one after another in one process and one ledger, each turn changing two files and each turn's gates measuring exactly those two, with test counts rising 2, 4, 5 and never falling. The bundle in `evidence/2026-08-24/session/` verifies from outside the workspace, 119 records, 3 claims verified and 2 refused. A turn ends by recording where it left the tree, `../src/gates/turn-baseline.ts`, and changes are measured through a scratch index rather than the person's, `../src/gates/scratch-index.ts`, without which the second turn reports its own edits as deletions |
| The review page says what the run was asked to do, what it decided, and what it changed | `../src/evidence/review-page.ts` with `../src/evidence/review-page.test.ts`: the header carries the tasks, the model, whether the loop completed, the duration and the cost; the gate table is rendered into the bundle rather than printed only to a terminal; and the patch the task produced is recorded as a ledger record and shown. A screenshot of a real one is `evidence/2026-08-24/review-page.png` |
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
