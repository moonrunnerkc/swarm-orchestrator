/**
 * The model endpoint as an instrument: whether it answers, and which server process answers.
 * The endpoint is local, so the process listening on its port names the instance; a server
 * that died and was restarted between two probes is a different process with a later start.
 * (The `created` field the server lists for its model is the time of the request, not the
 * server's start, so it cannot serve as an identity.) A launch whose endpoint changed instance
 * mid-way was served by an instrument that failed, which the protocol records as
 * infrastructure, never as the arm.
 */
import { spawnSync } from "node:child_process";

/** The port the endpoint URL names, with the scheme's default when it names none. */
export function endpointPort(endpoint) {
  const url = new URL(endpoint);
  return url.port !== "" ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
}

/** `pid <n> started <time>` for the process listening on the port, or null when none is found. */
export function listeningInstance(port, run = spawnSync) {
  const listed = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8",
  });
  const pid = (listed.stdout ?? "").trim().split("\n")[0] ?? "";
  if (!/^\d+$/.test(pid)) return null;
  const started = run("ps", ["-o", "lstart=", "-p", pid], { encoding: "utf8" });
  const start = (started.stdout ?? "").trim();
  return start === "" ? null : `pid ${pid} started ${start}`;
}

/**
 * `{ instance, problem }`: the answering process when the endpoint lists models and a listener
 * is found, otherwise what went wrong. An endpoint that answers from no local process (a remote
 * server) has no instance, and a change cannot be detected for it.
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
    if (!response.ok) return { instance: null, problem: `HTTP ${response.status}` };
    const body = await response.json();
    if (!Array.isArray(body?.data) || body.data.length === 0)
      return { instance: null, problem: "no models listed" };
    return { instance: instanceOf(endpointPort(endpoint)), problem: null };
  } catch (cause) {
    return { instance: null, problem: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Null while the same instance still answers; otherwise the change, for the infrastructure record. */
export function instanceChange(before, after) {
  if (after.problem !== null) return `the endpoint stopped answering: ${after.problem}`;
  if (after.instance !== before)
    return `the endpoint restarted (was ${before ?? "no local process"}, now ${after.instance ?? "no local process"})`;
  return null;
}
