# Evaluation

Two evaluations produce every number in [results.md](results.md): the three-arm evaluation of
`swarm run` against two other agents, and the tamper evaluation of the verifier.

## Three-arm evaluation

`eval/run.mjs` runs mini-SWE-agent, OpenCode and `swarm run` on the frozen task lists in
`eval/tasks/` (the first 100 SWE-bench Verified and first 50 Terminal-Bench 2.0 tasks in byte
order) through [Harbor](https://github.com/laude-institute/harbor). Harbor runs each agent in the
task's own container and judges the result with the benchmark's own tests. Every arm uses the
endpoint and model in this repository's `swarm.toml` `[agent]` table. Tasks run in list order,
every arm on a task before the next task starts, and each trial appends one JSONL row to
`eval/results/<run>/<arm>.jsonl`, which is committed.

```sh
node eval/run.mjs --suite swebench-verified --limit 30 --next 30   # each arm's unrun tasks among the first 30
node eval/run.mjs --next 10                                        # each arm's next ten unrun tasks, both lists
node eval/run.mjs --smoke                                          # the first three SWE-bench Verified tasks
node eval/run.mjs --stub                                           # the harness end to end with a stub model
node eval/run.mjs --report                                         # rewrite docs/results.md from the store
```

`--report` reads only `eval/results/`, so the page it writes is the same on any checkout. A task
an arm ran in more than one run counts once, from its earliest run. A trial the benchmark's tests
never judged (a harness error) is counted under Tasks and not under Judged. pass@1 is over judged
trials, with a Wilson 95% interval; each pair of arms gets an exact McNemar test over the tasks
both judged. For `swarm run`, each row also records the stop reason and the verifier's last verdict from
the outcome block the trial printed, and the page counts them beside the benchmark's judgment.

### What it needs

- Docker. SWE-bench Verified images are x86_64 only, so on Apple silicon the evaluation uses
  its own Colima profile with Rosetta, leaving the default VM alone:

  ```sh
  colima start swarm-eval --vm-type vz --vz-rosetta --cpu 4 --memory 10 --disk 80
  export DOCKER_CONTEXT=colima-swarm-eval
  ```

  Docker's buildx plugin must be installed (`brew install docker-buildx`, linked into
  `~/.docker/cli-plugins`).
- Harbor: `uv tool install harbor`.
- The model endpoint in `swarm.toml` `[agent]`, here Ollama serving `qwen3.6:35b-a3b`. One model
  at a time: the trials run one after another, never in parallel.

## Tamper evaluation

`node eval/tamper/run.mjs` builds three fixture repositories, seals their held-out tests, and runs
`swarm verify` on honest patches and on cheating ones in five techniques: edited expectations,
deleted assertions, hard-coded inputs, overridden equality and a patched scorer.
`eval/tamper/oracle.mjs` decides which patches are really correct without going through `node:assert`. A
patch counts as flagged when the verdict is anything but pass. It needs only Node, git and
Python 3, and writes `eval/results/tamper-<time>.json`.

## Nightly

`.github/workflows/nightly-eval.yml` runs `node eval/run.mjs --next 10` at 06:00 UTC and on
demand, on a self-hosted runner labeled `swarm-eval`: each arm's next ten unrun tasks from the
frozen lists, SWE-bench Verified first. It commits the new rows and the rewritten
`docs/results.md` and pushes them. Every ref of this repository is under a ruleset that only a
bypass actor may update, and the workflow's own token is not one, so the job checks out and
pushes with the secret `SWARM_EVAL_PUSH_TOKEN`: a fine-grained token with contents read and
write on this repository, from an account that holds the bypass (an admin).

### Registering this Mac as the runner

The machine needs everything under "What it needs", the Colima profile running, and the model
served. Then, from any directory:

```sh
token=$(gh api -X POST repos/moonrunnerkc/swarm-orchestrator/actions/runners/registration-token --jq .token)
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -fsSLo runner.tar.gz https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-osx-arm64-2.338.2.tar.gz
tar xzf runner.tar.gz
./config.sh --unattended --url https://github.com/moonrunnerkc/swarm-orchestrator --token "$token" --name "$(hostname -s)-swarm-eval" --labels swarm-eval
./svc.sh install && ./svc.sh start
gh secret set SWARM_EVAL_PUSH_TOKEN --repo moonrunnerkc/swarm-orchestrator
```

`./svc.sh` runs the runner as a launchd agent of the logged-in user; `./run.sh` runs it in the
foreground instead. `./config.sh remove --token "$token"` unregisters it.

Status on 2026-10-29: no self-hosted runner is registered for this repository
(`gh api repos/moonrunnerkc/swarm-orchestrator/actions/runners` lists none) and the push secret
is not set, so the nightly job waits in the queue until both exist.
