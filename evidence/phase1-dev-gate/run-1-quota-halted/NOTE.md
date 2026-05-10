# run-1-quota-halted — Phase 1 dev gate, partial evidence

The first attempt to run the gate against the post-parser-fix adapter
halted at obligation A8 because the operator's ChatGPT-account weekly
usage limit was reached mid-run. The full re-run is captured under
`run-1/` of this directory once API-key auth is configured.

## What happened

Obligations A1–A7 ran to completion. A8 hit the quota wall on the
codex side; codex stderr returned:

> ERROR: You've hit your usage limit. Upgrade to Plus to continue
> using Codex (https://chatgpt.com/explore/plus), or try again at
> May 15th, 2026 3:21 PM.

The runner halted on the first errored obligation per the
"no defensive try/catch" policy. Partial state is preserved verbatim.
This is not an adapter bug; it is a real billing/auth situation that
the runner correctly surfaced.

## Aggregate (Stratum A, 7 of 8 obligations)

- 21 confirmed counter-examples produced.
- 0 false positives.
- ~$0.434 USD (token-based estimate; ChatGPT-account auth is flat
  subscription so the dollar figure is informational, not real-billed).
- ~96 s wall-clock for the seven completed obligations.

| id | resultKind | yield | FP | $ | ms |
|----|---|---:|---:|---:|---:|
| A1 | counter-example-input | 3 | 0 | 0.034 | 14608 |
| A2 | counter-example-input | 3 | 0 | 0.088 | 12803 |
| A3 | counter-example-input | 3 | 0 | 0.119 | 15619 |
| A4 | counter-example-input | 3 | 0 | 0.048 | 12878 |
| A5 | counter-example-input | 3 | 0 | 0.048 | 12432 |
| A6 | counter-example-input | 3 | 0 | 0.050 | 14533 |
| A7 | counter-example-input | 3 | 0 | 0.047 | 13235 |
| A8 | errored             | 0 | 0 | 0.000 |  4693 |

## How to resume

ChatGPT weekly limit resets May 15 — six days out. To continue
without waiting:

1. Provision an OpenAI API key with billing enabled at
   https://platform.openai.com/api-keys.
2. Add `OPENAI_API_KEY=sk-...` to `.env` (project root). Never commit
   it; `.env` is in `.gitignore`.
3. Re-run `node dist/scripts/phase1-dev-gate/run-gate.js --run 1`.
   The runner now sources project `.env` before spawning codex, so
   the key automatically reaches the subprocess.

API-auth lifts the ChatGPT-account model restriction; the runner
still passes no explicit `--model`, so codex uses whatever default
the operator's API account is allowed to invoke.

## Why this is preserved

No fabricated evidence. The partial state is what it is. The
observed pattern (Stratum A: 100% yield rate, 0 FP across 7 of 8
obligations) is corroborated independently by `run-1-aborted/`'s
Stratum A from the prior parser-bug halt — two independent partial
runs of the same prompts give the same result, which is itself
useful evidence even before the full gate completes.
