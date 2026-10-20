/**
 * An arm's model request, watched from its own event stream rather than by a request of the
 * harness's own. The Swarm arm prints one JSON event per line while it runs: `model-call` when a
 * request starts, `model-text` as text streams, `model-error` with `willRetry: true` when it
 * sends the request again, and then whatever the answer led to (a tool call, a claim, the next
 * call, a stop). A request is open from its start until any event that is not streamed text; while
 * it is open, the quiet time is the time since the stream last said anything. A request that has
 * been quiet past the declared deadline is a stall.
 *
 * The deadline is set from the recorded healthy latencies, not guessed: on 2026-10-20 the ordinary
 * launch's 120 calls on the same model answered within 17.8 seconds (first token within 13), with
 * prompts up to 54,000 tokens, and the server's own log shows no completed request on this model
 * above 1 minute 40 seconds. The calls the stalled launch waited on were quiet for 249 and 487
 * seconds and had never reached the runner. Three minutes is above every healthy observation and
 * the model's theoretical longest answer (a full context evaluated plus the output cap generated),
 * and well under the wall, so a stall is named while the launch still has time to be scored as an
 * infrastructure failure rather than consumed as the arm's result.
 *
 * Only the Swarm arm's stream is read this way; OpenCode's stream names its steps but not its
 * requests, so for that arm the wall is still the only bound on a request.
 */

/** The declared deadline on an open request's quiet time, unless the manifest says otherwise. */
export const inferenceDeadlineMs = 180_000;

/** Events that keep a request open: the request's start and the text that streams inside it. */
const opening = new Set(["model-call"]);
const streaming = new Set(["model-text"]);

/**
 * Returns the watch. `observe(chunk)` is fed the arm's stdout as it arrives; `state(now)` says
 * whether a request is open, since when it has been quiet, and the stall when the quiet time
 * passes the deadline. Partial lines are held until their newline arrives.
 */
export function createStallWatch({
  deadlineMs = inferenceDeadlineMs,
  now = () => Date.now(),
} = {}) {
  let buffered = "";
  let open = null;
  let quietSince = null;
  let lastEvent = null;
  const read = (line) => {
    if (!line.startsWith("{")) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (parsed?.schema !== "swarm.event.v1") return;
    const event = parsed.event;
    if (event === undefined || typeof event.type !== "string") return;
    const at = now();
    lastEvent = { type: event.type, step: event.step ?? null, at };
    if (opening.has(event.type)) {
      open = { step: event.step ?? null, startedAt: at, retries: 0 };
      quietSince = at;
      return;
    }
    if (event.type === "model-error" && event.willRetry === true) {
      // The call is being sent again: a new request on the same step.
      open = {
        step: event.step ?? open?.step ?? null,
        startedAt: at,
        retries: (open?.retries ?? 0) + 1,
      };
      quietSince = at;
      return;
    }
    if (streaming.has(event.type)) {
      if (open !== null) quietSince = at;
      return;
    }
    open = null;
    quietSince = null;
  };
  return {
    observe(chunk) {
      buffered += chunk.toString();
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) read(line.replace(/\r$/, ""));
    },
    state(at = now()) {
      if (open === null) return { open: null, quietMs: 0, stalled: null, lastEvent };
      const quietMs = at - quietSince;
      return {
        open,
        quietMs,
        lastEvent,
        stalled:
          quietMs > deadlineMs
            ? `the arm's model call at step ${open.step ?? "?"}${open.retries > 0 ? ` (retry ${open.retries})` : ""} has had no answer for ${Math.round(quietMs / 1000)} s, past the declared request deadline of ${Math.round(deadlineMs / 1000)} s`
            : null,
      };
    },
  };
}

/**
 * Polls the watch every `intervalMs` and calls `onStall` once with the reason and the moment it
 * was seen. Returns the function that stops the polling. Detection takes at most the deadline
 * plus one interval.
 */
export function pollStallWatch(watch, { intervalMs = 2_000, onStall, now = () => Date.now() }) {
  let stopped = false;
  let timer = null;
  const tick = () => {
    if (stopped) return;
    const { stalled } = watch.state(now());
    if (stalled !== null) {
      stopped = true;
      onStall(stalled, new Date(now()));
      return;
    }
    timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, intervalMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
