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

## 6. The trial (live model)

[protocol.md](protocol.md), registered at `964f7c721`; the manifest frozen at `ebbc24c4f`;
[launches.md](launches.md). One launch of Swarm with `--plan-checks` on build `826e60e83`, the
same base, task text, visible check, model and limits as the earlier trial's launches; not given
the reference, the hidden evaluator, an earlier candidate or a developer-written check. Records:
[launch-1/record.json](launch-1/record.json) (the runner's, with the readiness sequence and the
probe totals), [launch-1/final.patch](launch-1/final.patch), [probe-launch-1.json](probe-launch-1.json)
(the frozen behaviour probe on the exact patch), and the product's stdout, stderr and both session
chains, restorable with `node scripts/evidence-pack.mjs restore launch-1/packed-derived/launch-1-streams`.
**P** is the planning chain `20261020T045117-41e2cc-plan`, **R** the run chain; times are seconds
from the run's first record.

**Inference was restored.** The readiness sequence, the first inference after the server's
recovery, completed in 3.1 s: the chat request answered in 2.41 s (the runner loading the model
inside it), the tool-call request in 0.47 s with a well-formed call of the probe's tool, the
tool-result request in 0.26 s; 753 tokens, recorded apart from the task's. During the launch the
server answered all 146 of the product's requests (149 chat completions in the window, every one
HTTP 200, median 1.8 s, p95 9.4 s, the longest 47.1 s, which was the planner's last call, closed by
the planning wall at 47.2 s) and logged no parse failure. The lease was held throughout, the stall
watch ran on the arm's stream and never found an open request quiet past 180 s, and no halt was
recorded. These are the pass paths; the detecting paths were exercised on fixtures only (section 3).

**The delivered patch** removes the `i` flag from the GFM `url` rule and spells the schemes
`(?:[fF][pP][tT]|[hH][tT][tT][pP][sS]?)?`, and does the same in the `text` rule's lookahead.
`[fF][pP][tT]` matches "fpt", so bare `ftp://` no longer links. Scored on the exact bytes:

| | result |
| --- | --- |
| the task's example `(See hTtPS://example.com/fhqwhgads.)` | **linked, trailing period excluded**, as upstream |
| `www.` (lower links; `Www.`, `WWW.` plain) | as upstream |
| email, inline `http://`, `HTTP://FOO.COM`, `<hTtPS://example.com/>` | as upstream |
| bare `ftp://example.com/file`, inline `ftp://files.example.com/a.txt` | **not linked**; upstream links both |
| project test suite | 1,713 of 1,713 pass (the runner's visible verdict and the product's `tests` gate) |
| visible check | passes |
| hidden oracle (upstream autolink spec examples) | **pass**: the spec examples hold no `ftp://` case |
| the product | **`not accepted`, exit 1**: "blocking gate(s) failed: task-diagnostics; the change was executed and failed"; verdict `task: accepted` (the pinned goal checks), `behavioral: fail` |

So by the frozen oracle the patch passes, and by the task's own words ("without changing how
http://, https:// or ftp:// are detected") it does not. The oracle's gap on `ftp://` is the same
one the earlier trial's launch 1 found and the probe exists for. The product's own report is the
accurate one: it did not accept the patch, and said why.

**What the planning did, record by record** (P 0 to P 424, R 2 `plan-checks-v1`, R 12 the brief):

| step | what the records hold |
| --- | --- |
| first round | 33 steps, ended at its share of the wall (252 s, `max-wall-time`) with three checks declared: `email-autolink-working` (admitted, control unestablished: every case gave the same answer on the base), `www-case-sensitive` (refused `does-not-detect`: it passes on the base), `scheme-autolink-case-insensitive` version 1 (refused `disagrees-with-base`: case 1, the task's own example, expected linked, the base gave not-linked), then re-declared quoting only "Scheme autolinks must remain case-insensitive for the scheme" with four kept cases (`https://example.com`, `HTTP://example.com`, `Ftp://ftp.example.net/file`, `hTtP://Mixed.Example.com/path`), admitted. |
| the requested example | **kept as an outcome, not as a check.** `scheme-autolink-case-insensitive#1` (quoting the task's sentence with the example) stays unresolved: its task input `(See hTtPS://example.com/fhqwhgads.)` with the first expectation `linked` and the base's answer `not-linked`; the interpretation trail records version 1.3 dropping that input (`from: "linked", to: null`). `#2` (the shorter quote, no task input) is covered by the admitted version. The brief given to the worker names the input, the first expectation and the base's answer, and says to run the project on it and compare with the task's words. |
| revision | **ran**: `planned-check-revision-v2` `outcome: ran`, 84.0 s remaining against 60 s needed, nothing borrowed (limit 84 s), the measured admission 0 ms (the round's last base run was reused), the longest trial 32.4 s, the reserve 124.8 s. It stopped at `max-wall-time` after 28 steps having declared nothing: the `www` outcome stays uncovered ("the revision's allowance ended before it declared a replacement"). The coverage review was withheld. Planning: 336 s, 61 steps, 1,717,899 tokens. |
| implementation | 27 steps, 474,190 tokens, completed at R 197 (+444 s) with the claim above. The worker's own runs of the task's example linked it. |
| the generated check at work | every gate cycle: `task-acceptance` (the visible check) passed and **`task-diagnostics` failed**: "generated check scheme-autolink-case-insensitive rejected ... line 3 should be `{"input":"Ftp://ftp.example.net/file","result":"linked"}` but was `... "not-linked"`; case(s) 3 are behaviour the task keeps, which the unchanged base gave as expected". A live detection of the regression, by a kept case of an admitted check. |
| repair | attempt 1 (R 197 to R 489, +627 s): 40 steps, `max-steps`, 906,557 tokens; the ratchet accepted the candidate (one file, two lines, as before); diagnostics failed identically. Attempt 2 (to R 609, +712 s): 16 steps, `max-wall-time`, 291,211 tokens; its first words name the `[fF][pP][tT]` class as the problem; the ratchet accepted; diagnostics failed identically. Escalated at 2 of 3 attempts: the run's wall ended. **No repair improved correctness**: the final bytes carry the same class. |
| follow-up | **withheld**: `outcome-follow-up-v1` `state: "withheld"`, "model work ended before it could be given". It is owed once the gates are green, and they never were. |
| final verification | completed on the delivered tree: the last cycle's gates (R 609 to R 635), independent verification, two run assessments (R 647, R 658), exit 1 at +780 s; the bundle's own verifier passes every check. |

**Exercised live, with what each showed:** readiness admission (pass path); the lease and the
stall watch (running, nothing to find); the task-input anchoring (the example kept as an outcome
with its first expectation and the base's answer, the drop recorded, the brief naming it); revision
scheduling (the revision ran inside the allowance without borrowing); live detection by a
generated check of a kept behaviour the change broke; the repair loop under the ratchet; accurate
reporting. **Not exercised live:** the follow-up (withheld: never green); a stall, its halt and the
probe after it; a readiness refusal; recovery; a revision that declares a replacement; a repair
that improves correctness; `adopts-base-answer`.

**The earliest concrete product failure** is in implementation: the worker rewrote the scheme
class as `[fF][pP][tT]`, the same transposition as the earlier trial's ordinary launch, and its own
checks did not run bare `ftp://` through the rule it changed. Planning did its part this time: the
admitted check held a kept `Ftp://` case that failed on the candidate. The repair did not do its
part: 56 steps and 148 s across two attempts did not change the two characters, though attempt 2
had named them.

**Wall and tokens.** Probes: 3.1 s, 753 tokens. Task: 779.9 s (planning 336 s, implementation 108 s,
repairs and gates 335 s), 3,389,857 tokens (planning 1,717,899; implementation 474,190; repairs
1,197,768), 146 calls, none with unknown usage. Preparation 21.4 s and scoring apart.

## 7. Remaining limitations

- The detecting paths (a stall, the halt, the after-stall probe, a readiness refusal, recovery)
  are shown on fixtures through the real runner; no live server failed under the new harness.
- The stall watch reads the Swarm arm's stream only; OpenCode's names no requests, so for that arm
  the wall is still the only bound on a request.
- The request deadline is a declared number from recorded latencies, not a property of the
  server: a healthy request above 180 s on another model or prompt would be read as a stall.
- The readiness tool call asks the model to call a tool; a model that answers in prose fails
  readiness, which is the intended reading of the tool path but can refuse a working server on a
  flaky answer. Two sequences are allowed for that reason.
- The hidden oracle does not cover `ftp://`; the frozen behaviour probe does. The product's own
  generated check did too, this time; that it will on another launch is not established.
- The restart's necessity is not established (section 5).
- Whether the parse failure of the earlier launch caused its wedge is not established (section 1).

## Next action

Read the repair's two attempts on this launch (R 197 to R 609: what the worker ran, what it edited,
why 40 steps and then the wall passed with the two characters named and unchanged), and from that
record decide what, if anything, the repair brief or its step budget should carry before any
further launch; no planning rule is added on this result.
