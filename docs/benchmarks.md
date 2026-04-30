# Benchmarks

The primary v7 metric is **falsification catch rate** — the percentage of agent-claimed-success patches that fail at least one battery layer. Measured against `princeton-nlp/SWE-bench_Verified`, 50-instance stratified subset, seed=42 (manifest: [`benchmarks/swe-bench/instances-50.json`](../benchmarks/swe-bench/instances-50.json)).

Numbers land with the 7.0.0 release notes after the P4 sweep completes. The sweep harness is at [`benchmarks/swe-bench/`](../benchmarks/swe-bench/); it runs in a Docker image with all instance dependencies pinned.

Secondary metrics from the same sweep:

- SWE-bench Verified pass@1
- Mean wall clock per instance
- Mean premium requests per instance

Per-layer eval results for the falsification battery itself live at [`docs/p1-eval-results.md`](p1-eval-results.md). Layer 3 (cheat detector) has been independently evaluated against the seed=42 sample; layers 1 and 4 evals are gated on the same Docker harness as P4.

The earlier three-producer rubric harness under `benchmarks/harness/` predates v7 and is no longer the primary benchmark. It is retained on disk for archival reference.
