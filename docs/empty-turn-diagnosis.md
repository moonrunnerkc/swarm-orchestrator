# Diagnosing an empty assistant turn from a local backend

Two calibration bundles came back holding assistant turns that carried nothing. The runs were
recorded, the gates over their untouched workspaces exited zero, and nothing in either bundle
said the turns were empty. The containment for that is landed and described below. The cause is
not diagnosed, and this document says how to diagnose it rather than guessing at it.

## Status

**NOT-DONE: root cause.** The diagnosis needs the live local backends, Ollama and rapid-mlx at
`127.0.0.1:8000`, and the environment this pass ran in reaches neither: both ports refuse a
connection, so no instrumented exchange could be produced and nothing was measured. Guessing
from the assembled turn is exactly what this instrumentation exists to stop, so no cause is
proposed here.

**Landed:** the transport instrumentation (1.1), the harness reading of every turn at the record
that carries it into the bundle and the abstention that reads from it (1.2), and a regression
fixture reproducing the turn shape (1.3). Containment holds whatever the cause turns out to be:
a repeat made only of empty turns is an abstention naming a reason code, is filtered out of every
calibration dimension, and can no longer be presented as an executed run.

## What the three causes are

An empty turn downstream looks the same whichever of these produced it, which is why the bytes
have to be kept:

1. **The backend emitted nothing.** The completion carried no content, no reasoning and no tool
   call. The problem is the server or the prompt, not this client.
2. **The client dropped the content.** Content reached the wire and did not reach the turn. The
   problem is in stream assembly here.
3. **A chat template answered into another channel.** The backend emitted reasoning tokens and
   no answer beside them, so the template and the assembly disagree about where an answer goes.

## Running the instrumented path

The trace is off unless an environment variable names a file to write. It holds the whole prompt
and the whole completion, so it is a thing you turn on for one run you are watching.

```sh
# 1. Confirm the backend is up and serving the model the run will ask for.
curl -s http://127.0.0.1:8000/v1/models | head

# 2. Run the calibration against it with the trace on.
SWARM_LOCAL_TRANSPORT_TRACE=/tmp/wire.jsonl \
SWARM_LOCAL_BASE_URL=http://127.0.0.1:8000/v1 \
  swarm calibrate --models local:<the model that produced the empty turns> --repeats 3
```

The artifact is JSONL, one object per line, two lines per exchange, paired by an `exchange`
number that counts up in call order:

- `phase: "request"` carries `url`, `method`, `headers` and the raw request `body` exactly as it
  was handed to the transport, before anything parsed it.
- `phase: "response"` carries `status`, `headers` and the raw response `body` as it arrived,
  copied out of the stream as it was passed through rather than buffered and replayed.
- `phase: "transport-error"` replaces the response line when the call never produced one.

Header and body both go through the same scrub the ledger uses, so a trace cannot become the one
place a bearer token is legible.

## Reading it

`readWireContent` and `classifyEmptyTurn` in `src/providers/empty-turn-cause.ts` take a raw
response body and the assembled turn and return one of the five codes: `not-empty`,
`backend-emitted-nothing`, `reasoning-only`, `client-dropped-content`, or `unreadable-response`.
`describeEmptyTurnCause` gives each a sentence naming the layer to look at. The assembled turn to
compare against is in the bundle: each `model-call` record carries the harness's own reading of
its turn under `content`, with `empty` and an `emptyReason` of `no-content`,
`whitespace-only-text`, or `call-failed`.

So one empty exchange is diagnosed by pairing them: take the `exchange` number's response line
from the trace, take the `model-call` record at the same step, and classify.

## What to fix, per answer

- `backend-emitted-nothing`: the fix is at the backend or in the prompt, and the next thing to
  read is the request body in the same exchange. Compare it against a request the same pairing
  answered, which the trace of a working run holds.
- `reasoning-only`: the fix is the chat template or the reasoning setting. `[providers]
  local_thinking` is what turns reasoning on and off for a local endpoint, and the request body
  in the trace shows both spellings the servers accept.
- `client-dropped-content`: the fix is in this repository, in stream assembly, and the trace's
  response body is the reproduction.
- `unreadable-response`: read the status and headers on the response line first. A proxy or an
  error page in front of the backend produces this.

## The residual

Only the local transport is traced, because only local backends produced this. A frontier
provider that returned an empty turn would be marked empty at the record like any other, and
there would be no bytes to say why.
