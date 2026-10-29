# Evaluation results

The results store. `eval/run.mjs` appends one JSONL row per trial to `<run>/<arm>.jsonl`, in a
directory named for the run, and `eval/tamper/run.mjs` writes `tamper-<time>.json`. Rows an
`--into` rerun replaced are kept beside the new file with a `.superseded-<time>` or
`.invalid-*` suffix and are counted nowhere. Stub runs are not stored. `node eval/run.mjs
--report` rewrites `docs/results.md` from these files alone.

Harbor's job directories (agent logs and trajectories) stay in `~/.cache/swarm-eval/jobs/` on the
machine that ran them.
