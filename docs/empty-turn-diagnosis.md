# The empty assistant turns in the two calibration bundles

What is known, what is instrumented, and what is still undiagnosed. Written on 2026-08-31
against the two full calibration sessions of 2026-08-23 and 2026-08-24.

## What the two bundles actually hold

Both sessions ran the same 20-case golden set, three repeats, against three models served by
Ollama at `http://127.0.0.1:11434/v1`. Both completed and both produced a verdict.

| | 2026-08-23 | 2026-08-24 |
| --- | --- | --- |
| model-call records | 1177 | 1189 |
| assistant turns with neither text nor a tool call | 2 | 3 |
| repeats recorded as executed | 179 of 180 | 179 of 180 |
| pick | `local:qwen3.6:35b-a3b` | `local:gemma4:31b` |

Every empty turn in both bundles came from `local:qwen3.6:35b-a3b`, except one from
`local:gemma4:31b` in the second. They fall into two shapes, and the shapes want different
answers.

**Shape one: the output budget spent on nothing.** `finish_reason: length`, 4096 output tokens
reported, no text and no tool call reached the loop. This is the case the loop already
recognises and samples again, and the stop reason for it is `output-cap` rather than
`empty-response`. Both bundles predate that change, which is why their run records say
`empty-response` for a turn whose finish reason was `length`.

**Shape two: a stream that ended before it said anything.** `finish_reason: other`, zero input
tokens and zero output tokens, first token observed at 438 ms and the call over at 1146 ms.
Zero *input* tokens is the part that matters: the request asks for `stream_options.include_usage`,
every other call in the same session reports a real prompt-token count, and this one reports
none, so no usage chunk arrived at all. Something ended that stream early. Whether the backend
sent an empty body, or sent content that the client dropped while assembling the stream, cannot
be told apart from the assembled response, which is what `src/providers/transport-trace.ts`
was written to answer.

One fact narrows it usefully. Shape two landed on the same case (`pass3-isolation-none-coverage`),
the same model, the same repeat number and the same step in **both** sessions. The seed is
derived from exactly those three things, and step one of a repeat has no history in front of it,
so both sessions sent a byte-identical request and got the same nothing back. A stream drop that
depends on timing does not reproduce that way. This points at the backend answering that
particular request with nothing, and away from a random client-side loss. It does not settle it:
a deterministic client-side parse failure over a deterministic response would look the same.

## What is now in place

- `src/providers/transport-trace.ts` copies the raw request body and every raw response frame
  of a local call before anything parses them, keyed on `SWARM_TRANSPORT_TRACE` naming a file.
  Off with no path. The response body is teed rather than buffered, so streaming timing is
  unchanged and the first-token measurement stays real.
- `src/evidence/turn-content.ts` classifies each turn as it becomes a ledger record, and the
  record carries the verdict. An empty turn can no longer reach a summary as a run of the model:
  the repeat records `abstained` with a reason code, and the report prints the reasons beside
  the executed count.
- `src/providers/ai-sdk-model-client.ts` records what the backend said it could not apply, so a
  seed in a bundle is never read as a seed that made the run re-derivable.

## Still not diagnosed, and now for a better-supported reason

Eight live runs later, on two backends and two models, with the trace on throughout: not one
empty turn.

| backend | model | case | repeats | empty turns |
| --- | --- | --- | --- | --- |
| Ollama `127.0.0.1:11434/v1` | `gemma4:31b` | `pass2-tautology-line-split` | 3 | 0 |
| Ollama `127.0.0.1:11434/v1` | `gemma4:31b` | `pass3-isolation-none-coverage` | 2 | 0 |
| rapid-mlx `127.0.0.1:8000` | `qwen3.8:27b` | `pass2-tautology-line-split` | 3 | 0 |

The first row is the one that matters. `gemma4:31b` is one of the three models in the corrupt
bundles, `pass2-tautology-line-split` is the case it produced an empty turn on, and the seed is
derived from the case, the model and the repeat number, so repeat 3 sent the same request the
08-24 sweep sent. It answered in eight steps, all of them carrying something.

The two models that produced the other empty turns, `qwen3.6:35b-a3b` and `qwen3.5:27b`, are no
longer on this machine. Ollama holds sixteen models and neither is among them, so the pairing
that produced shape two cannot be pointed at from here at all.

What that does and does not support. It does not reproduce the failure, so the cause is still
undiagnosed and is still not guessed at here. It does make one reading better supported than it
was: whatever it was appears to have been true of those model builds, or of that Ollama version,
rather than of this harness, since the harness has not changed in the ways that would matter and
the same case and seed now runs clean. That is an inference from an absence, and it is written
down as one.

The instrumentation itself is verified against both live backends. The Ollama run captured 23
calls and 16,597 raw response frames, 3.7 MB, with the pinned `temperature`, `top_p`, `seed` and
`stream_options.include_usage` visible in the request body and no response carrying zero frames.

Reading that trace found one defect, in the instrumentation rather than in the backend. The
tracing fetch was built once per model rather than once per registry, so its call counter
restarted with every client a sweep asked for: 23 requests shared 8 call numbers, and no request
could be matched to the response it got, which is the one thing the artifact exists to let a
reader do. Fixed, with a test.

The abstention from task 1.2 is what makes the open question survivable rather than urgent. An
empty turn is now recorded as an abstention with a reason code and never scored against a model,
so the next occurrence costs a named unmeasured repeat instead of quietly costing a model the
case.

### Running the instrumented path against the pairing that failed

1. Start Ollama and pull the model the bundles used:

       ollama serve
       ollama pull qwen3.6:35b-a3b

2. Confirm the backend serves it under that exact id. The preflight matches on the id the
   backend publishes, and a near miss is excluded rather than dispatched:

       curl -s http://127.0.0.1:11434/v1/models

3. Run one calibration sweep with the trace on. The trace grows by roughly the size of every
   prompt and every completion, so put it somewhere with room:

       SWARM_LOCAL_BASE_URL=http://127.0.0.1:11434/v1 \
       SWARM_TRANSPORT_TRACE=/tmp/swarm-empty-turn.jsonl \
       swarm calibrate --models local:qwen3.6:35b-a3b --repeats 3

   The failure landed on `pass3-isolation-none-coverage` at repeat 2 in both sessions, so a
   single-model sweep is enough to look for it and costs an hour rather than three.

4. Find the empty turn in the session ledger, then find the call it came from in the trace.
   The run record names it directly now:

       jq -c 'select(.type=="calibration-run")' ~/.swarm/sessions/<id>/ledger.jsonl

   A repeat with `"abstained": true` names its reason; a repeat with `emptyTurns` above zero
   holds one inside an otherwise working run.

5. Read the frames for that call in the trace. The three causes separate cleanly there:

   - **The backend sent nothing.** `response-head` is a 200, and `response-end` reports zero
     chunks, or only the frames that carry no delta. The fix is at the backend or the chat
     template, not in this tree.
   - **The client dropped content.** The frames carry `delta.content` or `delta.tool_calls`
     that never reached the assembled response. The fix is in the provider layer, at
     `src/providers/ai-sdk-model-client.ts` or the SDK under it.
   - **The template produced a genuinely empty turn.** The frames carry a well formed
     completion whose content is empty, with a `finish_reason` the model chose. The fix is the
     request: the chat template flags in `src/providers/registry.ts`, or the prompt itself.

Until those frames exist for the failing pairing, this stays open. Shape one is already
handled, shape two is instrumented and abstained on, and neither is fixed at its cause.

## 2026-09-02: the failing request, replayed by digest against the live backend

`qwen3.6:35b-a3b` was pulled back onto this machine (Ollama reports it as `096fdbd02fe6`, 22 GB,
Q4_K_M) and the runbook above was run as written: one single-model sweep, 20 cases, three
repeats, `SWARM_TRANSPORT_TRACE` on throughout. 60 of 60 repeats executed, none abstained, no
turn in any of the 349 model calls was empty, and the trace holds 352 requests, every one of
them answered 200 with at least one chunk.

What makes this a replay rather than another rerun is the prompt digest. The 08-23 bundle's
shape-two record is sequence 830, a step-1 call carrying `promptDigest`
`sha256:9f26135e63be44a5f3a490b51b27abb0593532e4b710f5b82f2d386e5838ffb7`, and the run record
after it names `pass3-isolation-none-coverage` repeat 2, `executed: false`, `empty-response`.
The step-1 call of the same case and repeat in the 09-02 sweep carries the same digest, byte
for byte: same 297-character calibration system prompt, same one user message, same six tool
schemas, same `seed: 522856934`, `temperature: 0.7`, `topP: 0.95`, same 4096-token cap. The
earlier note that the 08-31 rerun had "sent the same request" was right about the seed and had
not checked the rest; this one has.

That request came back as eight steps of text and tool calls, and the repeat went green.

What that separates. The request is the same. The drain loop in
`src/providers/ai-sdk-model-client.ts` is the same as on 08-23: it raised on a stream error part
then and raises now, so an error frame would have surfaced as a failed call rather than as a
zero-token turn on either day. The SDK under it is the same, `ai` 7.0.65 and
`@ai-sdk/openai-compatible` 3.0.30 on both dates. What is not the same is the backend: Ollama is
0.32.14 today and its August version was not recorded, and the model tag has a build digest today
that the August bundles did not record either. So the variable is the backend as served on
those two days, and the three-way split in the runbook resolves to its first branch, the
backend sent nothing, by elimination rather than by frames: the frames from August do not exist
and cannot be produced, because that backend cannot be re-served.

What that does and does not support, stated plainly. It locates the cause outside this tree.
It does not name the defect inside that backend, and nothing here should read as if it did. It
is stronger than the 08-31 inference from absence, because the absence is now of a failure on
the identical request rather than on a similar one. And it leaves the harness where task 1.2
put it: a recurrence records an abstention with its reason and costs a named unmeasured repeat.

Two things this run changed on the machine, named so the next reader is not surprised by them.
The model is back on disk, and `swarm calibrate` wrote its pick to
`~/.swarm/routing/calibration-pick.json` as it does after every sweep, which is the tool
behaving as designed rather than a side effect: the latest measurement of this machine is the
one it routes on.
