# Mac runbook: finish the LLM-dependent stages

This file lives on the `mac-handoff` branch (force-added; plans/ is
gitignored on main). To pick up on the Mac:

```bash
git clone -b mac-handoff https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator
```

The branch is main (e7f4b883) plus this file and the remaining
proof-diff-cache entries; finished stages can merge or cherry-pick back
to main, minus this file.

Written 2026-06-09 on the VivoBook, where
these stages could not run: no GPU (Ollama loads with size_vram 0) and the
Anthropic key in .env is out of credits (API returns the low-balance 400).
Everything below is code-complete and committed; it only needs a machine
with working local inference (or restored API credits).

## State when written

- Agent corpus fetched and audited: 60 merged agent-attributed PRs across 6
  vendors, 228 structural findings, zero classified.
  `benchmarks/real-prs/agent-corpus/{sources.json,diffs/,audit-results/}`.
- `INCIDENCE-REPORT.md` is committed in its honest "classification pending"
  state; regenerating after the arbiter run replaces it with the measured
  headline (incidence + Wilson 95% interval).
- The arbiter is resumable: labels flush to
  `agent-corpus/arbiter-labels-dual.json` every 10 classifications, and
  already-labeled findings are never re-run.

## 0. npm publish (5 minutes, any machine, no LLM)

v11.2.0 is tagged and the GHCR image is live, but the npm publish job
failed: the NPM_TOKEN repo secret cannot write the `swarm-orchestrator`
package (npm returns its permission-denied-as-404 on PUT; the package is
owned by the `bradkinnard` npm account and the registry still serves
7.0.0-alpha.0). Fix:

1. npmjs.com > Access Tokens: create a token with read/write on the
   `swarm-orchestrator` package (granular, or a classic Automation token).
2. GitHub repo > Settings > Secrets and variables > Actions: replace
   NPM_TOKEN.
3. `gh run rerun 27238984554 --failed` (or re-push any v* tag).

## 1. Dual-arbiter classification (the missing P2 stage)

Two independent local model families via Ollama (or swap the secondary for
Anthropic Opus if credits are back: drop the --secondary-* flags).

```bash
cd ~/projects/swarm-orchestrator   # wherever the repo lives on the Mac
npm run build
ollama pull qwen3:14b && ollama pull gemma3:12b
OLLAMA_BASE_URL=http://127.0.0.1:11434 \
node dist/scripts/real-prs/arbiter-agent-prs.js \
  --primary-provider ollama --primary-model qwen3:14b \
  --secondary-provider ollama --secondary-model gemma3:12b
node dist/scripts/real-prs/build-agent-incidence-report.js
```

Then commit `agent-corpus/arbiter-labels-dual.json`, `arbiter-cost.json`,
and the regenerated `INCIDENCE-REPORT.md`. Expect roughly 228 x 2 calls;
the ollama path uses node:http with a 30-minute per-call ceiling, so slow
models are fine. Pick any two models from DIFFERENT families that fit the
Mac's memory; the report discloses whichever ids ran.

## 2. Judge-enabled agent audit (optional, better incidence)

The 60 PRs were audited with `--no-judge` (no credits), so the two
semantic categories (goal-not-fixed, cheat-mock-mutation) are absent from
the findings. With credits restored:

```bash
node dist/scripts/real-prs/audit-agent-prs.js --force   # re-audit with judge
# then rerun the arbiter + report as above (only new findings get classified)
```

Note `--force` re-audits all 60; the judge cache makes re-runs cheap.

## 3. Execution-grounded sweep leftovers (no LLM, but heavy)

Final VivoBook state (2026-06-09, committed and pushed in e7f4b883): 62 of
72 regression PRs have execution-grounded results, calibration says
corroborated-under-constraint = 3 firings / 3 confirmed reverted TP / 0 FP,
Wilson lower 0.438 vs the 0.90 bar. Exactly 10 PRs remain:

- tldraw/tldraw: #7681 #7708 #7880 #7885 #8306 #8347 #8378 #8501
  (8 PRs; mutation-viable, the repo most likely to add trigger TPs)
- withastro/astro: #16366 #16555 (red repo, auto-skipped: no test runner
  in the changed packages; these two will not produce results without an
  astro-specific recipe)

Memory warning that forced the stop: each tldraw PR's workspace build runs
the docs-site `next build` with ~20 jest workers (~5GB); ONE sweep process
at a time on a 16GB machine, two killed it. On a bigger Mac, shard with
SWARM_EG_SHARD (committed in 475f0e4a):

```bash
export SWARM_EG_NODE_BIN=$(dirname $(which node))   # must be Node 22
export SWARM_EG_CORPUS=regression
# one process per shard; i/2 means every 2nd selected PR, offset i
SWARM_EG_REPOS=tldraw/tldraw SWARM_EG_SHARD=0/2 node dist/scripts/real-prs/run-execution-grounded.js &
SWARM_EG_REPOS=tldraw/tldraw SWARM_EG_SHARD=1/2 node dist/scripts/real-prs/run-execution-grounded.js &
wait
node dist/scripts/real-prs/derive-stryker-viability.js
node dist/scripts/real-prs/correlate-execution-grounded.js
npm run block-eligibility:full
npm run block-policy:check
```

Then refresh the numbers in `benchmarks/real-corpus/BLOCK-REPORT.md` (the
results table, the proof-PR list, and the coverage line in Method) from
`block-eligibility.json`, update the matching sentence under "Limitations
and what's next" in README.md, and commit results + calibration together,
same shape as commit e7f4b883.

## 4. Stryker recipes still wanted (debugging, no LLM)

Mutation never starts in: cloudflare-workers-sdk (workerd pool), mui
(bespoke config), vercel-next.js, vitejs-vite (initial-test-run failure).
The recipe mechanism is in: drop
`benchmarks/regression-corpus/mutation-recipes/<slug>.json` with `env` /
`strykerConfig` keys (see the README there; nrwl-nx.json is the model).
Debug one repo at a time inside a provisioned workspace under
/tmp/swarm-eg-run/.
