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

## NOT-DONE: the root cause of shape two

Not diagnosed, and not guessed at.

The pairing that produced it was Ollama at `127.0.0.1:11434/v1` serving `qwen3.6:35b-a3b`.
On this machine on 2026-08-31 Ollama is not answering on that port and that model is not
served, so the instrumented path cannot be pointed at the thing that failed.

The instrumentation was exercised against the one local backend that is up, rapid-mlx at
`127.0.0.1:8000` serving `qwen3.8:27b`, and it works: the artifact holds the request body with
the pinned `temperature`, `top_p`, `seed` and `stream_options.include_usage`, then all seven
raw SSE frames of the reply, then the totals. The exact failing request was replayed against
that pairing three times with the same seed and answered with a well formed tool call all three
times, in 13 output tokens each time. That neither reproduces the failure nor clears anything:
it is a different runtime and a different model, and the only thing it establishes is that this
particular pairing is not the one that breaks.

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
