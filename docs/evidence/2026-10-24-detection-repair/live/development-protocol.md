# Live development run on retained candidates, written before its first launch

October 24, 2026. This is development evidence. It asks whether the revised review finds a real
defect, and whether the repair it is owed fixes it, with the live model and no scripted part
except the replayed candidate. It is not a comparison of agents or arms, and it compares no arm.

## Launches

- **Arm.** `swarm` (`--adaptive --review executable`) only.
- **Build and model.**
  - The build is pinned in the frozen manifest. It runs `candidate-review-v3`,
    `task-code-v1`, `project-loader-v1`, `failure-identity-v5` and `starting-candidate-v1`.
  - The model is `qwen3.6:35b-a3b` through local Ollama, one sequence at a time.
- **Cases.** The nine retained candidates of the [development set](../development/README.md),
  one launch each, in this order: D1, D2, D3, D4, D5, D6, C1, C2, C3.
  - Each starts from its candidate, replayed through the product's chokepoint as the first
    worker loop.
  - Every later model call is live: the reviewer and the repair.
- **Budgets.** The October 24 studies' budgets:
  - 720.5 s wall per launch, plus grace;
  - an 8,000,000 token cap;
  - a 60 s verification reserve.
- **Failure and replacement.** The study runner's rules. A launch that stops before any model
  request after the replay is a setup failure. Once the live model was asked, the outcome
  stands.
- **No coaching.** Nothing changes between launches. Only liveness is watched until all nine
  have ended. Hidden verdicts stay sealed until the block ends.

## Measures, per launch

- whether the review examined or was withheld, and why;
- for the harness's own probes of the task's code, and for each reviewer probe:
  - whether it loaded;
  - whether admission sent it back;
  - what each case read;
- each established finding, judged against the case's task as a real defect or a false
  accusation;
- the attempt it was owed:
  - given, kept or rolled back;
  - what the code change was;
  - whether the finding's cases hold on the delivered tree;
- the hidden verdict, on the starting candidate and on the delivered tree;
- the product's verdict, against the hidden verdict;
- wall time and tokens.

**A successful chain names the observation and the resulting change.** Each of these must hold:
1. An established finding whose case the case's task supports.
2. The attempt it was owed changed the code.
3. The ratchet kept that change.
4. The delivered tree passes, where the starting candidate failed, the hidden check the finding
   concerns.
5. The final verification's applied patch is the delivered one.

These do not count:
- a different verdict;
- a review that ran;
- a broken probe;
- lint cleaned up;
- a correct starting candidate.
