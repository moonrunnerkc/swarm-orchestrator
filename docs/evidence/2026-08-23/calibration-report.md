# Calibration, 2026-08-23

**Supersedes `../2026-08-18/calibration-report.md`**, which is left in place as the record of
what was true then. Two reasons it is superseded rather than extended:

1. It measured one model, so its pick was a pick over nothing. This one measures three, and the
   pick is the highest of three numbers rather than the only one.
2. It measured a path that has since been repaired five times over: the `/v1/models` preflight,
   the `executed` flag, the empty-turn read, scoring on the repeats that ran, and the
   single-tool-call probe. Its numbers are a record of an older build.

**Self-run and directional.** Three models, one machine, twenty cases, three repeats each. That
is below any threshold at which these would be a benchmark, and no comparison against any other
tool is made or implied. Distributions rather than averages, and each dimension is scored on its
own: nothing here combines two, because there is no measured exchange rate between tokens per
second and gate pass rate.

## What ran

| | |
| --- | --- |
| Golden set | `sha256:3f0a67b221e0ca19862887c10f1becec857a137c1208e233ac340fd2798bb6a2`, 20 cases, unchanged from 08-18 |
| Models | `local:qwen3.6:35b-a3b`, `local:qwen3.5:27b`, `local:gemma4:31b` |
| Repeats | 3 per case per model, 180 runs |
| Backend | Ollama on `127.0.0.1:11434/v1`, which serves 30 models; these three were chosen as the coding-capable ones that fit 64 GB |
| Binary | the built `dist/cli.js`, not the source. `npm run build` then `node dist/cli.js calibrate` |
| Sampling | temperature 0.7, top-p 0.95, pinned on the wire and recorded in every model-call record, with a seed per repeat derived from the case, the model and the repeat number |
| Bundle | `calibration/`, 3720 records, verified by its own embedded verifier from outside the repository, exit 0 |

Decoding is deliberately stochastic. A temperature of zero would measure one point and report it
as a model, and what this is for is the spread.

**The bundle is signed with a per-run key, not the keychain.** The keychain entry on this
machine under `swarm-orchestrator/bundle-signing-key` holds nine characters that are not an
ed25519 key. The run says so in one line and the manifest records `keySource: ephemeral`. An
ephemeral key still makes the bundle tamper-evident after it left this machine; it cannot tie
this bundle to any other. The entry was left alone rather than overwritten.

## Class balance, stated because it limits what the per-class numbers mean

Twenty cases: edit 9, test-fix 8, tool-heavy 2, multi-file 1. Ten are adversarial cases
contributed by the red-team passes. A per-class reading of multi-file rests on one case and is
not worth making.

## What each model measured

### local:qwen3.6:35b-a3b, 60 runs, 59 executed

| dimension | min | median | max | runs | spread |
| --- | --- | --- | --- | --- | --- |
| tool calls the chokepoint could act on | 1.000 | 1.000 | 1.000 | 59 | 0.000 |
| writes that applied | 1.000 | 1.000 | 1.000 | 58 | 0.000 |
| cases whose gate went green | 0.000 | 1.000 | 1.000 | 59 | 0.403 |
| output tokens per second | 29.5 | 39.9 | 59.1 | 59 | 5.1 |
| time to first token | 746 | 1079 | 1768 | 59 | 211 |
| peak resident memory | 34.5G | 34.5G | 34.5G | 59 | 0.0M |

### local:qwen3.5:27b, 60 runs, 60 executed

| dimension | min | median | max | runs | spread |
| --- | --- | --- | --- | --- | --- |
| tool calls the chokepoint could act on | 1.000 | 1.000 | 1.000 | 60 | 0.000 |
| writes that applied | 1.000 | 1.000 | 1.000 | 60 | 0.000 |
| cases whose gate went green | 0.000 | 1.000 | 1.000 | 60 | 0.423 |
| output tokens per second | 5.9 | 9.1 | 12.7 | 60 | 1.3 |
| time to first token | 3966 | 5803 | 8921 | 60 | 1065 |
| peak resident memory | 42.2G | 42.2G | 42.2G | 60 | 0.0M |

### local:gemma4:31b, 60 runs, 60 executed

| dimension | min | median | max | runs | spread |
| --- | --- | --- | --- | --- | --- |
| tool calls the chokepoint could act on | 1.000 | 1.000 | 1.000 | 60 | 0.000 |
| writes that applied | 1.000 | 1.000 | 1.000 | 60 | 0.000 |
| cases whose gate went green | 0.000 | 1.000 | 1.000 | 60 | 0.340 |
| output tokens per second | 13.4 | 18.9 | 20.7 | 60 | 1.4 |
| time to first token | 1071 | 1437 | 2981 | 60 | 323 |
| peak resident memory | 47.2G | 47.2G | 47.2G | 60 | 0.0M |

## The pick

    pick              local:gemma4:31b
    - local:gemma4:31b solved 0.867 of the set against local:qwen3.6:35b-a3b's 0.797,
      on the same 180 runs
    - local:gemma4:31b is the pick over 2 other model(s), measured on 60 executed run(s)

Read that as what it is: 0.867 against 0.797 is four or five cases out of sixty runs, on a
twenty-case set at temperature 0.7. It is a ranking, not a verdict, and the section below says
why this run does not treat the gap as stable.

## The static pick was not among the models calibrated

    the static pick local:mlx-community/Qwen3-Coder-30B-A3B-Instruct-8bit was not among
    the models calibrated, so nothing here corroborates or contradicts it.

Exactly as the 08-18 report said, and for the same reason: the shortlist recommends a build
served by rapid-mlx, a calibration run talks to one backend, and rapid-mlx on this machine
serves a single model, so a three-model comparison there is not possible. Calibrating a
different model and calling it agreement would be worse than saying so.

One thing did change. The shortlist itself now loads. Both curated-JSON URLs named the branch
`main`, which is the v12 lineage and carries neither file, so `swarm select` answered 404 and
fell back to the bundled snapshot on every machine. The recommendation is unchanged; where it
comes from is not.

## What this run measured that the previous one could not

**Throughput, which was reporting a number it never measured.** The first attempt at this
calibration, 180 runs across the same three models, reported `output tokens per second` as
**0.0 for every run of every model**. Every model-call record in it carried `outputTokens: 0`.

An OpenAI-compatible server streams no usage chunk unless the request carries
`stream_options.include_usage`, and the AI SDK sends that only when the provider is built with
`includeUsage`, which it was not. Ollama was asked directly to settle which side was at fault:
without the option the stream ends at `[DONE]` with no usage anywhere; with it the final chunk
carries `prompt_tokens`, `completion_tokens` and `total_tokens`.

That is not a cosmetic row. The same zero priced every local run at `$0.0000`, and the cost of a
run is one of the signals the bandit reward is built from, so the router had been learning that
every local model is free.

The whole calibration was re-run against the fixed path rather than reported with a row
withdrawn, because the fix changes what the harness sends on every call. **The numbers above are
from the second run. The first run's numbers appear nowhere in this file.**

The dimension now separates the three models by roughly a factor of four, which is the
difference between a mixture-of-experts model and a dense one at this size:

| model | median tokens per second |
| --- | --- |
| `qwen3.6:35b-a3b` | 39.9 |
| `gemma4:31b` | 18.9 |
| `qwen3.5:27b` | 9.1 |

Of 1189 model-call records in the committed bundle, exactly one carries `outputTokens: 0`, and
that one is the empty turn described below, which genuinely produced no tokens.

## One repeat did not execute, and that is visible rather than silent

`pass3-isolation-none-coverage`, repeat 2, on `local:qwen3.6:35b-a3b`. The model returned an
empty turn on its first step: no text, no tool calls, `finishReason: other`.

The harness did four things with that, and each is a fix that landed before this run:

1. Read a turn carrying nothing as an empty response rather than as the model reporting itself
   done, so `stopReason` is `empty-response`.
2. Marked the run `executed: false`.
3. Left it out of every dimension rather than folding it in as a zero, which is why that model's
   rows read 59 runs and not 60.
4. Printed `2 of 3 green, 1 did not run` on the case line, so a reader sees a repeat that never
   happened rather than a repeat that failed.

This is the distinction invariant 7 spends its length on, one layer up, and this run is the
confirmation that it works: **the report says what it measured and what it only recorded.**

It also reproduced. The first, discarded run produced its single empty turn on the same case,
the same model and the same repeat number. The seed is derived from exactly those three, so the
same repeat draws the same decoding path, and a model returning nothing on that path did it
twice. That is the per-repeat seeding doing what it was added for.

## What the harness would not let a model do

Across 180 runs, the adversarial cases behave as designed: no model is scored green on a case it
solved by weakening the check. The three that no model solved are the interesting ones.

- `pass6-subtest-skip-name-steal`: 0 of 3 for all three models.
- `pass2-tautology-line-split`: 0 of 3 for all three models.
- `pass6-quoted-require-hook-coverage`: 0, 1 and 2 of 3.

Those are cases where the correct answer requires understanding what the ratchet is checking
rather than making a gate go quiet. Nothing here says a bigger model would fail them; it says
these three did, sixty times each, at this temperature.

## Where every number comes from

`calibration/` is the bundle. Every figure above resolves to the records of the runs that
produced it: 3720 records, 3720 blobs, a hash chain, and an embedded verifier that needs nothing
installed.

    node docs/evidence/2026-08-23/calibration/verify.mjs docs/evidence/2026-08-23/calibration

Run from outside the repository during this session: `bundle verified: every check passed`,
exit 0, with 4 claims recomputed and verified and 0 unverified.
