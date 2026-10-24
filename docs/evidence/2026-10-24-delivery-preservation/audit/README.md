# An appended audit of the October 23 studies

The October 23 studies' frozen scores stand as published. This audit sits beside them and changes
none of them. It applies one stricter reading to every arm alike, with its own implementation:
[`audit-study.mjs`](audit-study.mjs) imports nothing from Swarm.

## What it reads, per launch

- **Requested and preserved behaviour.**
  - Where a task's hidden evaluator has two files, the audit runs them separately on the
    delivered tree: `behaviour-check.mjs` (what the task asked for) and `kept-check.mjs` (what it
    must keep). This holds for the fresh block and both confirmation rounds.
  - The development study's tasks have one combined file, so preserved behaviour is "not
    separately measured" there.
- **Requested tests.**
  - The patch's test files run on the delivered tree.
  - They also run on a control: the base source, or, for an API the base does not have, the base
    source with a deliberately wrong implementation added.
    - ufo `filterQuery` returns its input unchanged.
    - markdown-it's `strip_references` rule exists and strips nothing.
  - They count as sensitive only where executed assertions fail on the control and pass on the
    delivered tree. A load failure, a missing export or zero tests run does not count.
  - The nanoid refactor asks for no new test and is read as "not requested".
- **New static and test failures.**
  - Each static tool runs on its own, on the base and on the delivered tree. A `&&` script stops
    at its first failure and hides the rest, so the audit does not run the script.
  - The project's tests run with a structured reporter.
  - Failures are compared identity by identity (file and rule, or test file and name), counted,
    even where the base already fails. A fixed failure never offsets a new one.
- **Strictly complete.** The frozen hidden verdict passed, the requested and kept behaviour hold,
  the requested tests are sensitive, and nothing new fails.
- **Product verdict accuracy.** Swarm's own verdict against "strictly complete": a false accept
  or a false refusal.
- **Cost.** Wall time and tokens, from the record.

[`recompute-strict.mjs`](recompute-strict.mjs) applied the "frozen hidden verdict passed"
condition to outputs written before the script required it, from fields those outputs already
record. Before that, two development launches read strictly complete while their frozen hidden
verdict failed: p-limit `swarm-prose` sample 2, whose hidden check also runs the type tests.

## Results

[`summarize.mjs`](summarize.mjs) over [`results/`](results/):

| Study, arm | Launches | Frozen hidden pass | Requested behaviour | Kept behaviour | Requested tests sensitive | No new static finding | Strictly complete | Product accepted | False accepts | False refusals | Wall | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fresh, `swarm` | 6 | 4 | 4 | 4 / 6 | 4 (2 not requested) | 0 | 0 | 0 | 0 | 0 | 1,428 s | 7.12M |
| fresh, `swarm-control` | 6 | 4 | 4 | 4 / 6 | 4 (2 not requested) | 0 | 0 | 0 | 0 | 0 | 1,243 s | 5.67M |
| fresh, aider | 6 | 2 | 4 | 3 / 6 | 4 (2 not requested) | 0 | 0 | n/a | n/a | n/a | 2,380 s | 0.21M |
| fresh, OpenCode | 6 | 5 | 5 | 6 / 6 | 4 (2 not requested) | 0 | 0 | n/a | n/a | n/a | 938 s | 4.68M |
| confirmation 1, `swarm` | 3 | 1 | 1 | 3 / 3 | 2 (1 not requested) | 0 | 0 | 0 | 0 | 0 | 807 s | 3.27M |
| confirmation 1, `swarm-control` | 3 | 2 | 2 | 3 / 3 | 2 (1 not requested) | 0 | 0 | 1 | 1 | 0 | 693 s | 3.33M |
| confirmation 2, `swarm` | 3 | 1 | 1 | 2 / 3 | 2 (1 not requested) | 1 | 1 | 0 | 0 | 1 | 827 s | 3.57M |
| confirmation 2, `swarm-control` | 3 | 0 | 1 | 2 / 3 | 2 (1 not requested) | 1 | 0 | 0 | 0 | 0 | 1,350 s | 6.98M |
| development, `swarm` | 6 | 1 | 1 | not separately measured | 3 | 5 | 1 | 5 | 4 | 0 | 2,714 s | 12.27M |
| development, `swarm-prose` | 6 | 1 | 2 | not separately measured | 4 | 6 | 1 | 5 | 4 | 0 | 2,622 s | 12.56M |
| development, `swarm-control` | 6 | 2 | 2 | not separately measured | 4 | 6 | 2 | 6 | 4 | 0 | 2,024 s | 10.30M |

## What changes under the stricter reading

- **Fresh block.** Every launch the frozen scorer counted complete adds at least one static
  finding the base does not have, so no arm has a strictly complete artifact:
  - 4 `swarm`, 4 `swarm-control`, 3 aider and 5 OpenCode launches;
  - the additions are a Prettier finding in a file the change touched, or an ESLint problem in
    added code.

  The frozen rule counted lint only where the base passed it, and ufo's base fails Prettier on
  `src/punycode.ts`, so it never saw these. Swarm refused all of its eight. Under this reading
  those refusals were correct, though not for the reason Swarm gave, which was the base's own
  lint finding.
- **Requested tests.** The tests agree with the frozen reading on the ufo tasks, and the audit
  now shows why.
  - For the new `filterQuery` API, the frozen scorer's base run failed because the export did
    not exist. Against the deliberately wrong implementation, the same tests fail by executed
    assertions, so they do distinguish the requested behaviour.
  - On the development study, svgo's requested tests are unmeasured here, a limit of this
    audit. They are fixture files (`.svg.txt`) read by one runner file, and naming a fixture to
    vitest runs no test.
  - p-limit `swarm`, sample 1, is not shown sensitive: its added tests fail on its own delivered
    tree.
- **Confirmation round 2.** The `swarm` ufo bug-fix candidate is the one strictly complete
  artifact in either confirmation round, and Swarm refused it: the false refusal this stage
  corrects.
- **Development study.** Under this reading, 12 of its 16 product acceptances were false accepts
  (4 per arm), all on the svgo and markdown-it tasks, whose requested behaviour fails.

Records, task by task, with each identity that was added, every control's reading and the hidden
files' last lines, are in the four `results/audit-*.json` files. The study stage directories they
read (`~/.cache/swarm-study-2026-10-23c/<study>`) and the session ledgers are archived on the
`evidence/2026-10-23-preservation-review-sessions` branch.

## Reproduce

```sh
node audit-study.mjs --study ~/.cache/swarm-study-2026-10-23c/fresh --out results/audit-fresh.json
node recompute-strict.mjs results/audit-*.json   # only for outputs written before the rule
node summarize.mjs results/audit-*.json
```
