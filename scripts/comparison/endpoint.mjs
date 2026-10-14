/**
 * The model endpoint as an instrument: whether it answers, which models it lists, and which
 * server process answers. The endpoint is local, so the process listening on its port names the
 * instance; a server that died and was restarted between two probes is a different process with
 * a later start. (The `created` field the server lists for its model is the time of the request,
 * not the server's start, so it cannot serve as an identity.) A launch whose endpoint changed
 * instance mid-way was served by an instrument that failed, which the protocol records as a
 * stop of the campaign, never as the arm.
 *
 * While an arm is talking to the endpoint the instance is watched by its listener alone (lsof and
 * ps), never by a request: a second request on this server beside a long prefill is what killed
 * it in the third pass. The watch therefore sees a process that died or was replaced, and does
 * not see one that is alive and hung; the wall deadline covers that case.
 */
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** How often the listener is read during an invocation; detection takes at most this plus one read. */
export const instancePollMs = 2_000;

/** The port the endpoint URL names, with the scheme's default when it names none. */
export function endpointPort(endpoint) {
  const url = new URL(endpoint);
  return url.port !== "" ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
}

const listenerArgv = (port) => ["lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]];
const startArgv = (pid) => ["ps", ["-o", "lstart=", "-p", pid]];
const instanceFrom = (listed, startOf) => {
  const pid = (listed ?? "").trim().split("\n")[0] ?? "";
  if (!/^\d+$/.test(pid)) return null;
  const start = (startOf(pid) ?? "").trim();
  return start === "" ? null : `pid ${pid} started ${start}`;
};

/** `pid <n> started <time>` for the process listening on the port, or null when none is found. */
export function listeningInstance(port, run = spawnSync) {
  const listed = run(...listenerArgv(port), { encoding: "utf8" });
  return instanceFrom(listed.stdout, (pid) => run(...startArgv(pid), { encoding: "utf8" }).stdout);
}

/** The same reading without blocking the event loop, for the watch during an invocation. */
export async function listeningInstanceAsync(port) {
  const output = async (command, argv) => {
    try {
      return (await execFileAsync(command, argv, { encoding: "utf8" })).stdout;
    } catch (failed) {
      // lsof exits 1 when nothing listens; that is "no listener", not an error.
      return failed?.stdout ?? "";
    }
  };
  const listed = await output(...listenerArgv(port));
  const pid = listed.trim().split("\n")[0] ?? "";
  if (!/^\d+$/.test(pid)) return null;
  return instanceFromStart(pid, await output(...startArgv(pid)));
}

const instanceFromStart = (pid, start) =>
  (start ?? "").trim() === "" ? null : `pid ${pid} started ${start.trim()}`;

/**
 * `{ instance, models, problem }`: the answering process and the model ids it lists when the
 * endpoint answers and a listener is found, otherwise what went wrong. An endpoint that answers
 * from no local process (a remote server) has no instance, and a change cannot be detected for it.
 */
export async function probeEndpoint(
  endpoint,
  fetchImplementation = fetch,
  instanceOf = listeningInstance,
) {
  try {
    const response = await fetchImplementation(`${endpoint.replace(/\/$/, "")}/models`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { instance: null, models: [], problem: `HTTP ${response.status}` };
    const body = await response.json();
    if (!Array.isArray(body?.data) || body.data.length === 0)
      return { instance: null, models: [], problem: "no models listed" };
    return {
      instance: instanceOf(endpointPort(endpoint)),
      models: body.data.map((one) => String(one?.id ?? "")),
      problem: null,
    };
  } catch (cause) {
    return {
      instance: null,
      models: [],
      problem: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/** Null while the same instance still answers; otherwise the change, for the stop record. */
export function instanceChange(before, after) {
  if (after.problem !== null) return `the endpoint stopped answering: ${after.problem}`;
  if (after.instance !== before)
    return `the endpoint restarted (was ${before ?? "no local process"}, now ${after.instance ?? "no local process"})`;
  return null;
}

/**
 * Reads the listener every `intervalMs` until it is no longer `instance`, then calls `onChange`
 * once with the change and the time it was seen. Returns the function that stops the watch. A
 * null `instance` cannot be watched (nothing to compare against) and the caller says so.
 */
export function watchInstance(
  port,
  instance,
  { intervalMs = instancePollMs, onChange, lookup = listeningInstanceAsync },
) {
  let stopped = false;
  let timer = null;
  const tick = async () => {
    if (stopped) return;
    const now = await lookup(port);
    if (stopped) return;
    if (now !== instance) {
      stopped = true;
      onChange(
        now === null
          ? `the endpoint process stopped (was ${instance})`
          : `the endpoint restarted (was ${instance}, now ${now})`,
        new Date(),
      );
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
