# Matched mechanism study, registered before its first launch

October 24, 2026. This is a small matched study of one mechanism on retained candidates. It is
development evidence: the tasks are exposed and the candidates come from earlier studies. It can
show whether the detection-to-repair chain improves delivered code against the same build with
the review off. It cannot show general superiority.

## Arms

| Arm | Flags | What differs |
| --- | --- | --- |
| `swarm` | `--adaptive --review executable` | The revised review is on: the harness's run of the task's own code, the grounded loader, admission runs, and the reviewer's probes |
| `swarm-control` | `--adaptive` | The same pinned build and model, with the review off |

Everything else is identical in both arms:
- the pinned build (in the frozen manifest) and the model, `qwen3.6:35b-a3b` through local
  Ollama, one sequence at a time;
- the starting candidate, replayed as the first worker loop;
- permissions, the sandbox and its protected roots;
- the supplied goal contract (the visible check), the gate plan and every budget: 720.5 s wall
  per launch plus grace, an 8,000,000 token cap, a 60 s verification reserve.

## Cells, samples, order

Two task types, each with a defective and a correct starting candidate from the
[development set](../development/README.md):

| Cell | Task type | Starting candidate |
| --- | --- | --- |
| D1 | ufo feature | missing requested behaviour (the October 24 false accept) |
| C1 | ufo feature | correct |
| D4 | ufo bug fix | breaks behaviour the task keeps |
| C2 | ufo bug fix | correct, with the behaviour change the task authorizes |

- **Samples.** Two per arm and cell: sixteen launches.
- **Order.** Frozen in the manifest. Cell by cell, and within a cell the arm that goes first
  alternates by sample and by cell.
- **Replacement.** The runner's rules. A launch that stops before any live model request is a
  setup failure and is tried again after a recorded correction. Once the live model was asked,
  the outcome stands. Every launch runs.
- **Sealing.** Hidden verdicts stay sealed until all sixteen have ended. The implementer watches
  liveness only.

## Measures, per launch and summed per arm and cell

1. **Probes executed.** The harness's probes of the task's code, and the reviewer's probes, that
   loaded and answered.
2. **Real defects found.** Established findings on a defective start whose case the task
   supports.
3. **False accusations.** Established findings on a correct start.
4. **Feedback changed the implementation.** The attempt owed a finding wrote a different
   candidate.
5. **Repair retained.** The ratchet kept that candidate.
6. **Complete artifact correctness.** The hidden verdict on the delivered tree, and the stricter
   audit's reading where it applies.
7. **Preservation.** The hidden kept-behaviour check on the delivered tree.
8. **Product verdict accuracy.** Accepted and correct, accepted and wrong, refused and correct,
   refused and wrong.
9. **Cost.** Total wall time and tokens, and calls of unknown usage.

**A successful chain names the observation and the resulting code change** (see the
[development protocol](development-protocol.md)). These do not count as semantic review
improving code:
- a different status label;
- a reviewer invocation;
- a broken probe;
- lint cleanup alone;
- a correct first candidate.

## Stop rule

- **No successful chain in any `swarm` launch on D1 or D4.** The mechanism failed. There is no
  expansion, and the first concrete failure along the chain is reported. Nothing is added to
  compensate during or after this block.
- **The chain repeats** in at least three of the four `swarm` launches on D1 and D4, **no
  `swarm` launch makes a false accusation** on C1 or C2, and **budget remains.** A small fresh
  ordinary comparison may follow, against OpenCode and the ablation, on unseen tasks from more
  than one repository, under its own registered protocol.
- **Anything between.** It is reported as it is, with no expansion.

With two samples per cell, a difference of one or two launches is within chance.
