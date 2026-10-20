# Endpoint readiness, a stalled request during a launch, and one planned-check trial, 2026-10-19

Follow-up to [../requested-example/](../requested-example/README.md), on the local branch
`fix/requirement-coverage-and-verification-reserve`. Declared files: [scope.md](scope.md). The
product (`src/`, `packages/`) is unchanged from `005d5eb8d`; the comparison harness, its fixtures
and this evidence change. Three kinds of evidence stay apart: **recorded** (the earlier launch's
chains and the model server's log, read as they are), **deterministic** (fixture endpoints and the
fixture arm through the real runner, no model) and **live-model** ([protocol.md](protocol.md),
[launches.md](launches.md)).

## 1. What the earlier launch's records establish

The launch of 2026-10-20 03:04 UTC (launch 2 of [../requested-example/launches.md](../requested-example/launches.md),
Swarm with `--plan-checks` on build `b470b55e2`) is read from its restored streams
(`node scripts/evidence-pack.mjs restore ../requested-example/launch-2/packed-derived/launch-2-streams`)
and from the model server's own log ([ollama/server-log-before-restart.txt](ollama/server-log-before-restart.txt),
copied from `~/.ollama/logs/server.log`; the runner logs at verbosity 4, so every request that
reaches it leaves `slot launch_slot_`, `prompt eval` and `print_timing` lines). **P** is the planning
chain `20261020T030502-be5cf7-plan`, **R** the run chain; the product's stdout events are the
`swarm.event.v1` lines of the same restore. Times are the server's (MDT).

| step | record | what it holds |
| --- | --- | --- |
| the first planner call | P 4 `model-call-started` at 21:05:02.9; server task 11025: 3,997 prompt tokens evaluated in 1.25 s, 47 tokens generated in 0.35 s, `stop processing`, `all slots are idle`; then `qwen3coder.go:71` and `qwen35.go:108` "tool call parsing failed: expected element type \<function\> but have \<parameter\>"; HTTP 200 in 1.93 s | **The model generated a tool call the server's parser could not read.** The runner finished normally; Ollama's Go layer dropped the unparsed call and returned the prose that preceded it. |
| what the product received | P 5 `model-call`: `text` "I'll start by exploring the repository structure...", `toolCalls: []`, `finishReason: "other"`, `usageStatus: "unknown"`, 0 tokens; stdout `model-error` step 1 "the runtime ended its answer without a finish reason and without a tool call (finish reason other, 123 characters of text); a stream cut off mid-answer is not the model finishing", `willRetry: true` | A valid HTTP answer with no tool call and a finish reason the product does not accept as finishing. The product's retry of the same call is a product behaviour that was exercised correctly: it did not read prose as the planner's declaration. |
| the retry | P 6 `model-call-started` at 21:05:05.5; server: **no runner line at all** (no slot launch, no prompt eval); `aborting completion request due to client closing the connection` at 21:09:14.9; HTTP 500 after 4 min 9 s; P 7 `model-call` `cancelled: true`, "This operation was aborted"; stdout "the model call did not return within the 249313 ms left of the wall budget"; P 8 `session-stopped` `max-wall-time` | The request was accepted by the server and never dispatched to the runner. The client that closed the connection was the product, at its planning wall (249 s): the product has no per-request deadline for a local endpoint by design (`src/providers/local-fetch.ts`), and its own wall ended the call. |
| the implementation's call | R 26 `model-call-started` at 21:09:35.7; server: no runner line; abort at 21:17:42.5; HTTP 500 after 8 min 6 s; R 27 cancelled; R 28 `session-stopped` `max-wall-time` | The same: accepted, never dispatched, closed by the product at its run wall (487 s). |
| afterwards | `/v1/models` 200 at 21:18:40 (the runner's probe after the invocation), `/api/ps`, `/api/version` 200 at 21:19:16; a trivial chat request 500 after 1 min 30 s at 21:21:15, again with no runner line | The server process answered every model-free request and completed no inference for at least 16 minutes. The runner's endpoint watch read the listener and the listing, both healthy, so the launch was not halted. |

So the four conditions the question separates come out as follows.

- **Invalid model-generated tool arguments:** established for the first call. The model's output
  was a tool call in a form the server's qwen3.5 parser rejected (`<parameter>` where `<function>`
  was expected). That is a model answer, and the product handled it as one: no tool call was
  taken, the call was retried, nothing was declared on the strength of prose.
- **Provider response or tool-parser failure:** established, on the server's side, for the same
  call. The HTTP answer was well formed; the parser failure removed the call from it. The product's
  own stream reader saw a complete, valid stream with no tool call.
- **Request timeout:** none from the provider. The three later requests were ended by the product's
  own deadlines (planning wall, run wall) and by hand, as the server's "client closing the
  connection" lines say. The product has no request deadline for local endpoints; the wall is its
  only bound, and it held.
- **A server that remains alive but cannot complete inference:** established for the retry, the
  implementation's call and the trivial request after them. None reached the runner, while the
  listing, `/api/ps` and `/api/version` answered. The runner process itself was idle after task
  11025 (`all slots are idle`) and is no longer present on the machine.

**What is not established:** that the parse failure caused the wedge. It is the last event the
server logged before the first undispatched request, and nothing in the log or the records names
the mechanism inside Ollama's Go layer between accepting a chat request and handing it to the
runner. The correlation is recorded; causation is not claimed. The launch is an infrastructure
failure of the model server, as the earlier record says; it is not a measurement of
`--plan-checks`, and its first call is not evidence of anything about planning either way.

The healthy latencies this work's deadlines come from are in the earlier launch 1's restored
chains: 120 model calls, all answered, response time at most 17.8 s (p95 9.3 s, median 3.0 s),
first token at most 13.0 s, prompts up to 54,199 tokens; and in the server's log, no completed
request on this model above 1 minute 40 seconds.

## 2. What changed in the harness

The product's request handling is not the demonstrated defect: its calls terminated at its own
walls and were reported as aborted. The defect is the experiment's: the runner read a listing as
readiness and a listener as health, and so dispatched a launch to a server that could not complete
inference and then consumed that launch as the arm's result. The runner now:

- **Exercises inference before dispatch** ([scripts/comparison/inference.mjs](../../../../scripts/comparison/inference.mjs)).
  After the listing probe, a readiness sequence sends at most three chat completions in the
  product's exact wire shape (captured from the product's own provider with a recording fetch:
  `stream: true`, `stream_options.include_usage`, `reasoning_effort: "none"`,
  `enable_thinking: false`, `chat_template_kwargs`, `max_tokens`, `tools` with `tool_choice:
  "auto"`, the OpenAI assistant `tool_calls` and `tool` message encoding): a plain answer, a call
  of a harmless tool whose arguments must parse and carry the required field, and the answer
  after that call's result, carrying the model's own call back. Each answer is read as it streams
  and checked for structure (every chunk JSON, a finish reason, the `[DONE]` terminator, a byte
  bound). Each request has a hard deadline, the sequence has one, and at most two sequences are
  tried. Every request is recorded with its kind, status, first-byte time, wall and usage, and the
  sequence with its configuration, on the attempt record (`probes`), the halt and the recovery
  record; the probes' spend is totalled apart from the task's (`totals.probes`). No repository
  task, evaluator or reference is used, and nothing is written.
- **Watches the arm's own request** ([scripts/comparison/stall.mjs](../../../../scripts/comparison/stall.mjs)).
  The Swarm arm's stdout is observed as it arrives (an optional callback on the campaign's
  command runner). A model call is open from its `model-call` event, or a `model-error` with
  `willRetry: true`, until any event that is not streamed text; open and quiet past the declared
  deadline, it is a stall. The arm is stopped (which closes its request), the endpoint is probed
  once with the arm gone, and the launch is halted as an endpoint failure with both recorded. The
  halt stands whatever that probe answers: the harness ended the launch. OpenCode's stream names
  no requests, so for that arm the wall remains the only bound.
- **Sends no competing request.** A lease is held by an invocation for its whole run and by a
  probe while it asks; a probe asked for while an invocation holds it is refused and the refusal
  recorded, not sent.
- **Recovers only on inference.** `--recover` runs the same readiness after the pin revalidation;
  a listing that answers does not recover a halted campaign.
- **Freezes the bounds.** The manifest carries `inferenceDeadlineMs`, `readinessRequestDeadlineMs`,
  `readinessSequenceDeadlineMs` and `readinessSequences`; the runner's defaults are 180 s, 30 s,
  90 s and 2, set from the latencies in section 1.

Unchanged: the listener watch and the listing probe, the wall and its kill, the halt and recovery
records' meaning, the rerun rule, the lock. No health-monitoring service, recovery daemon or
automatic restart was added. A healthy model producing incorrect code remains the arm's result
(the fixture case below holds it). Nothing in `src/` changed.

## 3. The proof without a live model

[regressions-before.txt](regressions-before.txt) ([regressions-before.sh](regressions-before.sh))
runs the new cases against the starting harness `28efda8d6`, given this work's test files and
fixtures only. The two new modules' unit tests cannot load there (the modules do not exist), and
all seven runner cases fail. **Behavioural failures:** the starting runner dispatches a launch to a
server whose chat never answers, whose tool path does not work, and whose stream is cut (it reads
the listing as readiness); it lets an arm whose request stalls after a successful preflight run to
the wall and records the launch as the arm's result, as the launch of section 1 was; and it
recovers a halted campaign on the listing alone. **Failing only on new fields:** the round-trip and
slow-answer cases, whose launches the starting runner also dispatches, fail on the absent probe
records.

On the tested harness, through the real runner (`scripts/comparison/run.mjs` spawned as a process
with its own HOME, the fixture endpoint and the fixture arm; [scripts/comparison/run.test.mjs](../../../../scripts/comparison/run.test.mjs),
"readiness before dispatch and a request that stalls during a launch"):

| case | endpoint fixture | result |
| --- | --- | --- |
| model listing succeeds, chat never responds | `chat-never` | two sequences of one request each, each ended at its 500 ms deadline; halt `endpoint` before dispatch; no launch; the probes on the halt; the listing answered throughout |
| plain chat works, the tool-call path fails | `plain-only` | the chat request answered, the tool-call request failed "answered without a tool call"; halt before dispatch |
| a stream cut before its terminator | `cut` | "the stream ended without [DONE]", HTTP 200; halt before dispatch |
| a complete valid round trip | `healthy` | dispatched; the record carries one readiness sequence of three answered requests with usage, `totals.probes` apart from the arm's tokens; a `wrong` arm's patch is recorded as the arm's failed task, no halt; the sequence precedes each arm's start and nothing is sent during either |
| a healthy slow answer inside the deadline | `slow:400` | dispatched; first byte after 350 ms or more, each request under its 2 s deadline |
| a server that stops answering after a successful preflight | `wedge-after:3`, the fixture arm sending one real request | readiness answered; the arm's request, the fourth, never; the stall named between 2 s and 4 s after the request (deadline 2 s plus one 2 s poll); the arm gone within the termination bound; one probe after it, failed; halt `endpoint` naming both; the attempt kept with `SIGKILL(interrupted)` and both probes; the request log shows nothing sent between the arm's request and its end; the listing still answers; the same command then refuses to continue |
| recovery | `chat-never`, then a healthy server on the same port | `--recover` refused while chat never answers, no recovery record; accepted once the round trip completes, the recovery record carrying it |

The unit tests ([inference.test.mjs](../../../../scripts/comparison/inference.test.mjs),
[stall.test.mjs](../../../../scripts/comparison/stall.test.mjs)) cover the wire body field for
field, stream reading (text, split tool-call deltas, usage, the terminator, non-JSON chunks, error
chunks, the byte bound), each kind's judgement, the request deadline against a request that never
answers, the lease, the lower-bound spend, and the stall watch's open, quiet, retry, partial-line
and polling behaviour with an injected clock.

## 4. Verification before the trial

[verification.md](verification.md).

## 5. The model server's recovery

[ollama/service-before.json](ollama/service-before.json), [ollama/service-after.json](ollama/service-after.json).
Before: `ollama serve` pid 3744 (started 2026-09-29 14:07:15, version 0.32.14, supervised by
Ollama.app pid 3743, `OLLAMA_CONTEXT_LENGTH=131072`), no model loaded (`/api/ps` empty: the idle
runner had been unloaded), no established connection on its port, no other session on the machine,
no `llama-server` process. The log excerpt was copied first. At 2026-10-20 04:45:29 UTC the
`ollama serve` child alone was sent SIGTERM; its supervising app respawned it within one second as
pid 76525 (started 22:45:30 MDT), version 0.32.14, the same seventeen models listed. The app was
not relaunched, so the update it has staged (v0.40.6) was not applied; no model was downloaded,
removed or changed. No inference request was sent before the protocol was registered.

Whether the restart was needed is not established: the wedged runner had already been unloaded, and
whether the server's Go layer would have dispatched the next request is unknown. The restart is
recorded as the one authorized recovery, and the readiness sequence of the trial is the first
inference after it.
