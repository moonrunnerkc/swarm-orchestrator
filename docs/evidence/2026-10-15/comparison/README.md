# Comparison of 2026-10-15: readiness, calibration and the scored stages

The registered rules are in [protocol.md](protocol.md); the task choices and exclusions in
[candidates.md](candidates.md); the deterministic validation of every task in
[validation.json](validation.json) (and the withdrawn feature task in
[validation-withdrawn-csstree-feature.md](validation-withdrawn-csstree-feature.md)). Every
number below is derived from the records and packaged blobs under this directory; the stdout
excerpt copies the publisher writes are packed losslessly beside each stage
(`output/packed-derived/`), and each tool's request settings as captured by a proxy are in
`readiness/request-capture-*.jsonl`.

## Readiness

### Canaries (at most four executions of two minutes; three ran, plus one option probe)

The smoke bug fix (`smoke-bugfix-parse-seconds`: make a duration parser accept seconds) through
each tool's ordinary entry point, one invocation, no corrections, scored by the hidden oracle in
a fresh checkout. Records under [readiness/canaries-rapidmlx/](readiness/canaries-rapidmlx/) and
[readiness/canary-ollama/](readiness/canary-ollama/).

| tool | configuration | connected, model, tools, read, edit, check, report | hidden oracle | agent time | tokens (input / output / reasoning) |
| --- | --- | --- | --- | --- | --- |
| Swarm | rapid-mlx, `qwen3.8:27b` | yes: 7 model calls, read, shell, edit, its tests gate, acceptable verdict, exit 0 | pass | 78 s | 35,200 (34,129 / 1,071 / 0) |
| OpenCode | rapid-mlx, `qwen3.8:27b` | yes: bash, read, edit, its own test run, final answer, exit 0 | pass | 48 s | 43,975 (43,457 / 518 / 0) |
| OpenCode | Ollama, `qwen3.6:35b-a3b` | yes, the same | pass | 14 s | 58,623 (57,818 / 805 / 0) |
| OpenCode | rapid-mlx (option probe, one request, no task) | which model options reach the request body | not scored | 9 s | 10,471 |

Swarm on Ollama was not canaried again: the live diagnosis of the morning (launch 2) already
drove it through the same path on that configuration with edits, gates and a verdict.

What the captured requests show ([readiness/request-capture-rapidmlx.jsonl](readiness/request-capture-rapidmlx.jsonl),
[readiness/request-capture-ollama.jsonl](readiness/request-capture-ollama.jsonl)):

| setting | Swarm | OpenCode |
| --- | --- | --- |
| max_tokens | 8192 | 8192 |
| thinking | `enable_thinking: false`, `chat_template_kwargs.enable_thinking: false`, `reasoning_effort: "none"` | the same three, after the repair below |
| sampling | none sent (the server's defaults: temperature 1.0, top_p 0.95 on both servers) | `top_p: 0.95` sent; no temperature |
| tool_choice | auto | auto |
| tools declared | 9 (read, write, edit, list, search, shell, claim, declare_file_set, amend_file_set) | 9 (bash, edit, glob, grep, read, skill, task, todowrite, write) |
| system prompt | 6,737 characters | 9,336 characters (Ollama: 9,344) |

The first OpenCode canary's requests carried no `reasoning_effort` although the harness had
written one: OpenCode's provider maps its own `reasoningEffort` option to that wire field and
overwrites a `reasoning_effort` given directly. The option probe sent both spellings and the
field arrived; the harness now writes the SDK spelling, and the Ollama canary's requests carry
`reasoning_effort: "none"`, which is the one spelling Ollama's route reads. Reasoning tokens were
0 in every canary on both servers.

### The retained csstree bug fix under OpenCode (development diagnosis, not comparative evidence)

| launch | configuration | outcome | agent time | tokens (input / output) | shape |
| --- | --- | --- | --- | --- | --- |
| [diagnosis-3](readiness/diagnosis-3-opencode-rapidmlx/) | rapid-mlx, `qwen3.8:27b` | not delivered: no edit, killed at the wall, hidden fail | 16.0 min | 4,620,544 (4,607,177 / 13,367) | 152 turns, 150 bash calls, 147 of them one identical `ls` of two paths that do not exist |
| [diagnosis-4](readiness/diagnosis-4-opencode-ollama/) | Ollama, `qwen3.6:35b-a3b`, thinking off | not delivered: edited `lib/generator/create.js` wrongly (a 7,014-byte patch with a stray `.bak` copy), one scripted correction killed at the wall, hidden fail | 16.0 min | 5,906,078 (5,864,399 / 41,679) | 35 turns in the first invocation: a sub-agent exploration, 9 reads, 21 bash calls, 3 edits |

With the morning's two Swarm launches ([../bugfix-diagnosis/README.md](../bugfix-diagnosis/README.md):
`qwen3.8:27b` repeated itself without editing; `qwen3.6:35b-a3b` edited wrongly), both tools
have failed this task under both configurations, each differently. The protocol's reading
applies: the model alone is not shown responsible, the task is not looped on further, and the
readiness requirement moves to one calibration task both tools must deliver. The csstree fix
stays an unresolved limitation of its own.

### Calibration

Filled in from the calibration records below once they exist.
