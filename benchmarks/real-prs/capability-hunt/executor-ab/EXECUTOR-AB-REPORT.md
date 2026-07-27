# Executor A/B: multi-ecosystem restoration control

Paired A/B with the restoration executor as the only intended variable. The
change makes Go and Python suites runnable where they previously died at spawn.
It is a **coverage** change, so it must not move a verdict on any entry whose
controls already executed. This report measures that rather than asserting it.

## Design

- **Population.** The 6 entries of recall pass 3 on which at least one proof
  control executed. Those are the only entries where a verdict could regress,
  because they are the only ones whose run path was ever exercised.
- **Before.** `benchmarks/real-prs/capability-hunt/recall-v3/pass3`, deterministic
  arm, measured at `bb0dc2f1`.
- **After.** `benchmarks/real-prs/capability-hunt/executor-ab/after`, deterministic
  arm, same entries, same recorded `baseSha`/`headSha` pair, same environment.
- **Environment.** Identical on both sides: darwin/arm64, Darwin 25.5.0, node
  v22.22.3, go1.26.3, Python 3.14.4.
- **Compared fields.** A verdict difference is any change to bucket, bucket stage,
  gate pass, gate triggers, replay confirmation, or the finding multiset. Control
  counts, engines executed, and the abstention multiset are compared separately as
  coverage.

## Result

**Verdict diff is empty. All 6 entries are fully identical**, coverage included.

| entry | before | after | status |
|---|---|---|---|
| `lesmartiepants/poetry-bil-araby#545` | advisory-found, 13 controls, 1 finding | advisory-found, 13 controls, 1 finding | identical |
| `myhuemungusD/SkateHubba-play#382` | abstained, 6 controls, 0 findings | abstained, 6 controls, 0 findings | identical |
| `omniscient/markethawk#408` | abstained, 8 controls, 0 findings | abstained, 8 controls, 0 findings | identical |
| `outline/outline#12197` | abstained, 8 controls, 0 findings | abstained, 8 controls, 0 findings | identical |
| `torch-spyre/ktir-cpu#104` | abstained, 7 controls, 0 findings | abstained, 7 controls, 0 findings | identical |
| `vitejs/vite-plugin-react#1246` | abstained, 6 controls, 0 findings | abstained, 6 controls, 0 findings | identical |

Every one of the 6 is a Node run path. Node scope resolution is unchanged by
construction: the command still runs at the workspace root with
workspace-relative paths, and `execBin` still resolves `npx` into the pinned Node
bin dir. The identical control counts confirm the run path was not merely
verdict-compatible but byte-for-byte the same set of executions.

## A measurement defect found and fixed during this A/B

The first run of the delta reported 3 verdict changes. That was a defect in the
comparison, not in the executor: the loader read every `*.json` under `records/`,
so `<id>.judge.json` and `<id>.deterministic.json` both matched and one arm
overwrote the other. The comparison had silently become deterministic-versus-judge,
which differs for reasons that have nothing to do with the variable under test.
The loader now filters on the arm suffix, and the comment at that call site says
why the filter is load-bearing. Recorded here because a paired A/B that compares
the wrong pairs is worse than no A/B.

## Replay

```bash
node dist/scripts/real-prs/recall-v3.js --arm deterministic \
  --dataset benchmarks/real-prs/wild-cheat-corpus/v3/dataset.json \
  --viability benchmarks/real-prs/capability-hunt/b2-ab/corpus-viability-delta.json \
  --ids claude-code-lesmartiepants-poetry-bil-araby-pr545,claude-code-myhuemungusD-SkateHubba-play-pr382,claude-code-omniscient-markethawk-pr408,claude-code-outline-outline-pr12197,claude-code-torch-spyre-ktir-cpu-pr104,codex-cli-vitejs-vite-plugin-react-pr1246 \
  --out-dir benchmarks/real-prs/capability-hunt/executor-ab/after

node dist/scripts/real-prs/executor-ab-delta.js \
  --before benchmarks/real-prs/capability-hunt/recall-v3/pass3 \
  --after benchmarks/real-prs/capability-hunt/executor-ab/after \
  --arm deterministic \
  --out benchmarks/real-prs/capability-hunt/executor-ab/EXECUTOR-AB-DELTA.json
```

The delta script exits non-zero when the verdict diff is not empty.
