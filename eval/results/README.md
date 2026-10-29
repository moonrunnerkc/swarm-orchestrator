# Evaluation results

`eval/run.mjs` writes one JSONL file per arm per run here, in a directory named for the run, and
`eval/tamper/run.mjs` writes `tamper-<date>.json`. Everything here except this file is ignored
by git. `eval/report.mjs` turns the latest of each into `docs/results.md`, which is committed.

The archive copy of every run that reaches `docs/results.md` goes to
[moonrunnerkc/swarm-orchestrator-archive](https://github.com/moonrunnerkc/swarm-orchestrator-archive)
under `eval/results/<run>/`, together with its Harbor job directory.
