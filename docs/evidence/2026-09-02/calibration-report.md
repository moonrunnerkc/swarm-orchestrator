# Calibration report, 2026-09-02

Four sweeps of the 20-case golden set on this machine, three repeats per case, on the two local
backends it serves, each preflighted against `/v1/models` before a repeat was dispatched, each
with its sampling pinned on the wire and in every model-call record. This supersedes the 08-23
report as the current measurement of this machine and leaves it in place as the record of
what was true then. Every number below is read from the `calibration-run` records of the
bundles beside this file by `../../../scripts/compare-calibrations.mjs`, and every comparison
between sweeps is between two distributions, never between two numbers.

## Trust condition

Gate 1 made calibration data untrusted until the empty-turn cause was confirmed against live
backends. What this run showed is in `../../empty-turn-diagnosis.md`: the request that came back
empty in August, identified by its prompt digest, was replayed against the live backend and
answered in full, with the client, the drain loop and the SDK unchanged since the day it failed.
The cause is located in the backend as served in August, which cannot be re-served. On that
basis these sweeps are treated as trusted, with the abstention from task 1.2 as the running
check: a sweep with an abstained repeat is not trusted data, and none of these has one. Every
repeat below executed, which means the model answered at least once, and no turn in any of
them was empty.

## The sweeps

| Sweep | Backend | Models | Repeats executed | Bundle |
| --- | --- | --- | --- | --- |
| first, 19:41 UTC | Ollama 0.32.14 at `127.0.0.1:11434/v1` | `local:qwen3.6:35b-a3b` | 60 of 60 | `calibration/qwen36-first/` |
| pair, 20:59 UTC | Ollama | `local:gemma4:31b`, `local:mistral-small3.2:24b` | 120 of 120 | `calibration/gemma4-mistral/` |
| second, 22:38 UTC | Ollama | `local:qwen3.6:35b-a3b` | 60 of 60 | `calibration/qwen36-second/` |
| rapid-mlx, 00:22 UTC on 09-03 | rapid-mlx at `127.0.0.1:8000/v1` | `local:qwen3.8:27b` | 60 of 60 | `calibration/qwen38-mlx/` |

One sweep that did not run is recorded rather than dropped. The rapid-mlx sweep was first started
at 22:37 UTC, the moment the pair sweep finished, and rapid-mlx refused the connection: its
canary got no usable tool call in three attempts, so the tool wrote a bundle saying it would
have measured the runtime rather than the model, created no runs and wrote no pick. The server
was answering again by 22:48 and the sweep was rerun once it was, after the second qwen3.6
sweep rather than before it, so no two sweeps shared the machine.

The first sweep predates the competency table and the re-derivation script, so its bundle is
format 1; the other three are format 2. Sampling on every call: temperature 0.7, top-p 0.95, a
seed per repeat derived from the case, the model and the repeat number, and the record beside
each seed says whether the backend reported taking it.

Golden set `sha256:3f0a67b221e0ca19862887c10f1becec857a137c1208e233ac340fd2798bb6a2`, 20 cases,
the same set the 08-23 report measured, which is what makes the comparisons below comparisons.

## What each model measured

### local:gemma4:31b, Ollama, 60 of 60 executed

| dimension | min | median | max | runs | spread |
| --- | --- | --- | --- | --- | --- |
| tool calls the chokepoint could act on | 1.000 | 1.000 | 1.000 | 60 | 0.000 |
| writes that applied | 1.000 | 1.000 | 1.000 | 59 | 0.000 |
| cases whose gate went green | 0.000 | 1.000 | 1.000 | 60 | 0.373 |
| output tokens per second | 14.4 | 17.8 | 19.8 | 60 | 1.4 |
| time to first token (ms) | 956 | 1136 | 1584 | 60 | 164 |
| peak resident memory | 20.4G | 20.4G | 20.4G | 60 | 0.0M |

Green on 50 of 60: every case three of three except `pass2-tautology-line-split` (0 of 3),
`pass6-subtest-skip-name-steal` (0 of 3), `pass5-quoted-isolation-none-coverage` (1 of 3) and
`pass6-quoted-require-hook-coverage` (1 of 3). By class: edit 23 of 27, multi-file 3 of 3,
test-fix 18 of 24, tool-heavy 6 of 6.

### local:qwen3.6:35b-a3b, Ollama, two sweeps, 60 of 60 executed each

| dimension | first: min | median | max | second: min | median | max | spread first / second |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tool calls the chokepoint could act on | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0.000 / 0.000 |
| writes that applied | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0.000 / 0.000 |
| cases whose gate went green | 0.000 | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 | 0.300 / 0.321 |
| output tokens per second | 70.4 | 94.0 | 111.7 | 75.7 | 92.0 | 102.7 | 8.3 / 5.4 |
| time to first token (ms) | 346 | 421 | 713 | 361 | 431 | 770 | 85 / 89 |
| peak resident memory | 22.3G | 22.3G | 22.3G | 22.3G | 22.3G | 22.3G | 0.0M / 0.0M |

Green on 54 of 60 in the first sweep and 53 of 60 in the second. The cases that moved between
the two are each one repeat apart: `pass5-quoted-isolation-none-coverage` 1 then 2 of 3,
`pass5-printed-attribution-any-reporter` 3 then 2 of 3, `pass6-quoted-require-hook-coverage` 3
then 2 of 3; `pass2-tautology-line-split` was 2 of 3 both times and
`pass6-subtest-skip-name-steal` 0 of 3 both times. The second sweep, by class: edit 25 of 27,
multi-file 3 of 3, test-fix 19 of 24, tool-heavy 6 of 6. Two sweeps of one model on one day
agree on every dimension to within their own spread, which is what a distribution comparison is
for: neither sweep is the number, and the pair says how wide the number is.

### local:mistral-small3.2:24b, Ollama, 60 of 60 executed, not usable

| dimension | min | median | max | runs | spread |
| --- | --- | --- | --- | --- | --- |
| tool calls the chokepoint could act on | 0.250 | 1.000 | 1.000 | 60 | 0.218 |
| writes that applied | 0.000 | 0.000 | 1.000 | 14 | 0.452 |
| cases whose gate went green | 0.000 | 0.000 | 1.000 | 60 | 0.128 |
| output tokens per second | 14.9 | 27.6 | 29.8 | 60 | 2.9 |
| time to first token (ms) | 268 | 435 | 2950 | 60 | 482 |
| peak resident memory | 35.9G | 35.9G | 35.9G | 60 | 0.0M |

Green on 1 of 60. The tool excluded it from the pick before ranking anything: writes that
applied came out at a 0.286 share over the 14 repeats that wrote at all, under the 0.500 a
model needs to be usable, and the median run stopped after two steps. This is the floor doing
what it is for. The sixty repeats executed, so the numbers are a measurement of the model
and not of the backend refusing it, and they say the model does not drive these tools.

### local:qwen3.8:27b, rapid-mlx, 60 of 60 executed

| dimension | min | median | max | runs | spread |
| --- | --- | --- | --- | --- | --- |
| tool calls the chokepoint could act on | 1.000 | 1.000 | 1.000 | 60 | 0.000 |
| writes that applied | 1.000 | 1.000 | 1.000 | 60 | 0.000 |
| cases whose gate went green | 0.000 | 1.000 | 1.000 | 60 | 0.400 |
| output tokens per second | 12.8 | 15.3 | 17.2 | 60 | 0.8 |
| time to first token (ms) | 683 | 819 | 1232 | 60 | 162 |
| peak resident memory | not measured | | | | |

Green on 48 of 60: every case three of three except `pass2-tautology-line-split`,
`pass5-quoted-isolation-none-coverage`, `pass5-printed-attribution-any-reporter` and
`pass6-subtest-skip-name-steal`, each 0 of 3. By class: edit 24 of 27, multi-file 3 of 3,
test-fix 15 of 24, tool-heavy 6 of 6. Peak memory is not measured on this backend: the probe
reads it off Ollama's process list and rapid-mlx offers no equivalent, so the column says so.
The output rate is of this backend on this machine and is not comparable with the Ollama rows
above.

## Against the 08-23 report, distribution against distribution

The 08-23 bundle is the same set of records as the session dated 08-24 in the session store,
exported once; the diagnosis note's second August sweep is not in the store and is not compared.

**gemma4:31b, today against 08-23.** Green per case is identical on 18 of 20 cases and one
repeat apart on the other two, `pass5-quoted-isolation-none-coverage` and
`pass6-quoted-require-hook-coverage`, 1 of 3 today against 2 of 3 then. Output tokens per second
sit at 14.4 to 19.8 (median 17.8) today against 13.4 to 20.7 (median 18.9) then, one
distribution inside the other; time to first token is lower today, 956 to 1584 (median 1136)
against 1071 to 2981 (median 1442). Nothing here separates today's build from August's.

**qwen3.6:35b-a3b, today against 08-23.** This is the pairing the empty turn came from, and the
two distributions do not overlap on speed: 88.7 to 98.1 tokens per second between the
quartiles today, across both sweeps, against 38.2 to 42.3 then; time to first token 390 to
475 ms today against 987 to 1278 ms then; wall time per run 5.9 to 9.6 s today against 14.2 to
21.3 s then. Green per case moved the same way: `pass2-tautology-line-split` 2 of 3 in both of
today's sweeps against 0 of 3 then, `pass6-quoted-require-hook-coverage` 3 and 2 of 3 against
0 of 3, `pass5-printed-attribution-any-reporter` 3 and 2 of 3 against 1 of 3; and 60 of 60
executed today against 59 of 60 then, the one August repeat being the empty turn. The same
model tag, on the same backend address, is a different build or a different runtime today, and
the bundles carry no digest that would say which. That is the finding the diagnosis note rests
on, seen from the other side: what changed is the backend, and the change is large enough to
be a different distribution rather than a shifted one.

**mistral-small3.2:24b and qwen3.8:27b** were not measured in August and have nothing to be
compared with.

## The pick, and the competency table

Each sweep's pick is the tool's, over the models that sweep ran and no others, and the picks
were: the first sweep `local:qwen3.6:35b-a3b` over no other model; the pair
`local:gemma4:31b` over one, with `local:mistral-small3.2:24b` excluded as not usable; the
second qwen3.6 sweep itself; and the rapid-mlx sweep `local:qwen3.8:27b` over no other model.
The pick on disk is the last sweep's, which is the tool's rule: the latest measurement of this
machine is the one it routes on. No sweep ranked qwen3.6 against gemma4 against qwen3.8, and
this report does not either; their green counts, 53 to 54, 50 and 48 of 60, are single sweeps
of different backends, listed side by side and not ordered.

The competency table the three format 2 sweeps wrote, folded across them, all on golden set
`3f0a67b2`:

| model | edit | multi-file | test-fix | tool-heavy |
| --- | --- | --- | --- | --- |
| `local:gemma4:31b` | 23 of 27 | 3 of 3 | 18 of 24 | 6 of 6 |
| `local:mistral-small3.2:24b` | 1 of 27 | 0 of 3 | 0 of 24 | 0 of 6 |
| `local:qwen3.6:35b-a3b` | 25 of 27 | 3 of 3 | 19 of 24 | 6 of 6 |
| `local:qwen3.8:27b` | 24 of 27 | 3 of 3 | 15 of 24 | 6 of 6 |

Executed repeats whose gate passed, per class. The first qwen3.6 sweep predates the table and
is not in it. Every entry but multi-file clears the floor of six executed runs, so a router
asked about an edit, a test-fix or a tool-heavy task among these candidates has an entry to
answer from; multi-file has three executed runs per model, under the floor, and the table
abstains on it by name and the calibration pick stands. One limit is worth stating: the router
chooses among the candidates of the pick on disk, which are the last sweep's, so the table's
other rows inform a routing decision only once a sweep has run those models together.

## What was measured and what was only recorded

Measured: gate outcome per repeat, tool calls the chokepoint could act on, writes that applied,
output tokens per second, time to first token, steps, wall time, and peak resident memory, each
per executed repeat. Recorded and not measured: the seed, which both backends accept and neither
promises to sample from, and the model tag, which names a build the bundles do not carry a
digest of. The shortlist's static pick for this machine,
`local:mlx-community/Qwen3-Coder-30B-A3B-Instruct-8bit`, was not among the models calibrated,
exactly as the 08-23 report said of its own run, so nothing here corroborates or contradicts it.

## Limits

Sixty repeats per model is three per case, which is enough to see a case a model never solves
and not enough to rank two models that differ by one repeat on one case. The two qwen3.6 sweeps
were run nine and two hours apart on one day, so their agreement is a fact about that day's
backend and not a stability guarantee. Speed dimensions are of the backend and the machine as
much as of the model, and the rapid-mlx and Ollama arms are different backends by design.
