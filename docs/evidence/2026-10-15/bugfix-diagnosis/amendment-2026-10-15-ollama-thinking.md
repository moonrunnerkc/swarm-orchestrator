# Amendment of 2026-10-15 to the live diagnosis: launch 2's spend was prompt, not thinking, and Ollama's off switch works

[README.md](README.md) stands as written; its records, numbers and the decision it reports are
untouched. This amendment corrects two readings in it, from the same retained ledgers and a
second probe of the same server.

## What the README says

That with Ollama "thinking cannot be turned off through the OpenAI-compatible route the product
uses", that launch 2's model "spent each allowance on thinking", and that "each invocation spent
its 600,000-token allowance in about three minutes of thinking".

## What the ledgers show

The three sessions of launch 2 are published under [launch-2/diagnosis-2/sessions/](launch-2/diagnosis-2/sessions/)
and their payloads are in the local session store they were packed from. Summed over every
`model-call` record (`inputTokens`, `outputTokens`, and whether the response text held a
`<think>` block):

| session | model calls | input tokens | output tokens | largest prompt | responses with a think block |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20261015T151632-e32117 (initial, stopped before its first call) | 0 | 0 | 0 | 0 | 0 |
| 20261015T151928-cca316 (correction 1) | 42 | 597,443 | 6,930 | 25,106 | 0 |
| 20261015T152229-8e7356 (correction 2) | 31 | 610,299 | 10,715 | 32,678 | 0 |

The allowance went to the prompt re-sent on every call as the conversation grew, not to
reasoning: output was about one per cent of the spend, and no response carried a think block.
The same shape holds for launch 1 (session 20261015T150049-342599: 61 calls, 597,895 input,
3,613 output). The cost driver in both launches was cumulative input, which is what the token
accounting now records by kind ([CHANGELOG](../../../../CHANGELOG.md), `inputTokens`,
`outputTokens`, `reasoningTokens`, `cachedInputTokens` on every model-call, stop and settled
budget record) and what the loop's reservation of the next prompt now bounds.

## What the probe shows

The README's stream probe ([stream-probe-ollama.json.gz](stream-probe-ollama.json.gz)) sent
`enable_thinking: false` and `chat_template_kwargs: { enable_thinking: false }`, and the server
streamed 183 reasoning deltas. Those are the two spellings Ollama's OpenAI route does not read;
the spelling it documents is `reasoning_effort`, and the product has sent all three on every
local call since the provider registry was written (`src/providers/registry-thinking.test.ts`
holds the request body). A probe of the same server (Ollama 0.32.14, model `qwen3:0.6b`, a
thinking model) sending each spelling alone and together:

| request | reasoning deltas | completion tokens | answered |
| --- | ---: | ---: | --- |
| no thinking field | 171 | 177 | yes |
| `reasoning_effort: "none"` | 0 | 2 | yes |
| `think: false` | 74 | 80 | yes |
| `enable_thinking: false` with the templated form | 174 | 180 | yes |
| `reasoning_effort: "low"` | 198 | 200 (cap) | no |
| all three off spellings together | 0 | 2 | yes |
| `reasoning_effort: "none"` with a tool declared | 0 | 36 | tool call |
| all three with a tool declared | 0 | 30 | tool call |

Scripts [ollama-reasoning-effort-probe.mjs](ollama-reasoning-effort-probe.mjs) and
[ollama-reasoning-effort-probe-2.mjs](ollama-reasoning-effort-probe-2.mjs); their output as
run, one line per request, is [ollama-reasoning-effort-probe.jsonl](ollama-reasoning-effort-probe.jsonl).
The product's body, which carries `reasoning_effort: "none"`, turns thinking off on this
server; the published probe's body, which did not, is what the README's sentence described.

## What this changes

- Ollama with Qwen is a configuration the product runs with thinking off, through the route it
  uses, with no adapter change. The baseline's configuration for that server names
  `reasoning_effort` as well (`scripts/comparison/workspace.mjs`), so both arms send what the
  server reads.
- Launch 2's non-delivery stands as a wrong edit caught by the gates; its cost was prompt, and
  the README's attribution of it to thinking is withdrawn.
- Nothing above makes either launch a delivery, and nothing in it changes the pilot's decision.
