import { describe, expect, it } from "vitest";
import {
  endpointPort,
  instanceChange,
  listeningInstance,
  probeEndpoint,
  watchInstance,
} from "./endpoint.mjs";

const listing = { object: "list", data: [{ id: "qwen3.8:27b", object: "model", created: 1 }] };

function fakeRun(table) {
  return (command, argv) => {
    const key = `${command} ${argv.join(" ")}`;
    const hit = Object.entries(table).find(([prefix]) => key.startsWith(prefix));
    return { stdout: hit ? hit[1] : "", status: hit ? 0 : 1 };
  };
}

describe("the endpoint instance", () => {
  it("reads the port from the endpoint URL", () => {
    expect(endpointPort("http://127.0.0.1:8000/v1")).toBe(8000);
    expect(endpointPort("https://example.test/v1")).toBe(443);
    expect(endpointPort("http://example.test/v1")).toBe(80);
  });

  it("names the listening process by pid and start time, and nothing when none listens", () => {
    const run = fakeRun({
      "lsof -nP -iTCP:8000 -sTCP:LISTEN -t": "4242\n",
      "ps -o lstart= -p 4242": "Mon Oct 12 16:20:01 2026\n",
    });
    expect(listeningInstance(8000, run)).toBe("pid 4242 started Mon Oct 12 16:20:01 2026");
    expect(listeningInstance(8001, run)).toBeNull();
    const gone = fakeRun({ "lsof -nP -iTCP:8000 -sTCP:LISTEN -t": "4242\n" });
    expect(listeningInstance(8000, gone)).toBeNull();
  });

  it("reads a restart as a different instance and a dead endpoint as a problem", () => {
    const before = "pid 4242 started Mon Oct 12 16:20:01 2026";
    expect(instanceChange(before, { instance: before, problem: null })).toBeNull();
    expect(
      instanceChange(before, {
        instance: "pid 5151 started Mon Oct 12 17:00:00 2026",
        problem: null,
      }),
    ).toBe(
      "the endpoint restarted (was pid 4242 started Mon Oct 12 16:20:01 2026, now pid 5151 started Mon Oct 12 17:00:00 2026)",
    );
    expect(instanceChange(before, { instance: null, problem: "fetch failed" })).toBe(
      "the endpoint stopped answering: fetch failed",
    );
    expect(instanceChange(null, { instance: null, problem: null })).toBeNull();
  });

  it("probes /models, lists the model ids, and turns every failure into a named problem rather than a throw", async () => {
    const answering = async () => ({ ok: true, json: async () => listing });
    const instanceOf = (port) => `pid 7 on ${port}`;
    expect(await probeEndpoint("http://127.0.0.1:8000/v1/", answering, instanceOf)).toEqual({
      instance: "pid 7 on 8000",
      models: ["qwen3.8:27b"],
      problem: null,
    });
    const refusing = async () => {
      throw new Error("fetch failed");
    };
    expect(await probeEndpoint("http://127.0.0.1:8000/v1", refusing, instanceOf)).toEqual({
      instance: null,
      models: [],
      problem: "fetch failed",
    });
    const broken = async () => ({ ok: false, status: 503, json: async () => ({}) });
    expect((await probeEndpoint("http://127.0.0.1:8000/v1", broken, instanceOf)).problem).toBe(
      "HTTP 503",
    );
    const empty = async () => ({ ok: true, json: async () => ({ data: [] }) });
    expect((await probeEndpoint("http://127.0.0.1:8000/v1", empty, instanceOf)).problem).toBe(
      "no models listed",
    );
  });

  it("watches the listener and reports once when it stops or is replaced, within one interval", async () => {
    const before = "pid 4242 started Mon Oct 12 16:20:01 2026";
    const seen = [];
    let current = before;
    const stop = watchInstance(8000, before, {
      intervalMs: 10,
      lookup: async () => current,
      onChange: (reason, at) => seen.push({ reason, at }),
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(seen).toEqual([]);
    current = null;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(seen).toHaveLength(1);
    expect(seen[0].reason).toBe(`the endpoint process stopped (was ${before})`);
    expect(seen[0].at).toBeInstanceOf(Date);
    current = "pid 5151 started Mon Oct 12 17:00:00 2026";
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(seen).toHaveLength(1);
    stop();

    const replaced = [];
    let instance = before;
    const stopSecond = watchInstance(8000, before, {
      intervalMs: 10,
      lookup: async () => instance,
      onChange: (reason) => replaced.push(reason),
    });
    instance = "pid 5151 started Mon Oct 12 17:00:00 2026";
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(replaced).toEqual([`the endpoint restarted (was ${before}, now ${instance})`]);
    stopSecond();

    const stoppedEarly = [];
    const stopThird = watchInstance(8000, before, {
      intervalMs: 10,
      lookup: async () => null,
      onChange: (reason) => stoppedEarly.push(reason),
    });
    stopThird();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(stoppedEarly).toEqual([]);
  });
});
