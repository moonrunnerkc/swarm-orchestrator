import { describe, expect, it } from "vitest";
import {
  localEndpointRecord,
  NoLocalEndpointError,
  resolveLocalEndpoint,
} from "./endpoint-resolution.ts";
import type { DiscoveredLocalEndpoint } from "./local-discovery.ts";

const ollama: DiscoveredLocalEndpoint = {
  name: "ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  models: ["qwen3.6:35b-a3b"],
};

const rapidMlx: DiscoveredLocalEndpoint = {
  name: "rapid-mlx",
  baseUrl: "http://127.0.0.1:8000/v1",
  models: ["glm47-flash-abl"],
};

describe("resolveLocalEndpoint with an explicit endpoint", () => {
  it("takes the pinned endpoint and never probes at all", async () => {
    let probed = false;

    const resolved = await resolveLocalEndpoint({
      pinned: { url: "http://10.0.0.5:11434/v1", origin: "config" },
      discover: () => {
        probed = true;
        return Promise.resolve([ollama]);
      },
      appleSilicon: true,
    });

    expect(probed).toBe(false);
    expect(resolved).toMatchObject({
      chosen: "pinned",
      url: "http://10.0.0.5:11434/v1",
      origin: "config",
    });
  });
});

describe("resolveLocalEndpoint by discovery", () => {
  it("prefers rapid-mlx on Apple Silicon when both runtimes answer", async () => {
    const resolved = await resolveLocalEndpoint({
      pinned: null,
      discover: () => Promise.resolve([ollama, rapidMlx]),
      appleSilicon: true,
    });

    expect(resolved).toMatchObject({
      chosen: "discovered",
      url: rapidMlx.baseUrl,
      runtime: "rapid-mlx",
      models: ["glm47-flash-abl"],
    });
  });

  it("prefers ollama off Apple Silicon when both runtimes answer", async () => {
    const resolved = await resolveLocalEndpoint({
      pinned: null,
      discover: () => Promise.resolve([ollama, rapidMlx]),
      appleSilicon: false,
    });

    expect(resolved).toMatchObject({ chosen: "discovered", runtime: "ollama" });
  });

  it("takes the one runtime that answered even against the platform preference", async () => {
    const resolved = await resolveLocalEndpoint({
      pinned: null,
      discover: () => Promise.resolve([ollama]),
      appleSilicon: true,
    });

    expect(resolved).toMatchObject({ chosen: "discovered", runtime: "ollama" });
  });

  it("fails an empty probe by naming both targets and every way to pin one", async () => {
    const attempt = resolveLocalEndpoint({
      pinned: null,
      discover: () => Promise.resolve([]),
      appleSilicon: true,
    });

    await expect(attempt).rejects.toThrow(NoLocalEndpointError);
    await expect(attempt).rejects.toThrow(/http:\/\/127\.0\.0\.1:11434\/v1/);
    await expect(attempt).rejects.toThrow(/http:\/\/127\.0\.0\.1:8000\/v1/);
    await expect(attempt).rejects.toThrow(/--local-endpoint/);
    await expect(attempt).rejects.toThrow(/SWARM_LOCAL_BASE_URL/);
    await expect(attempt).rejects.toThrow(/swarm\.toml/);
  });
});

describe("localEndpointRecord", () => {
  it("records a pinned endpoint as the user's decision", async () => {
    const resolved = await resolveLocalEndpoint({
      pinned: { url: "http://10.0.0.5:11434/v1", origin: "flag" },
      discover: () => Promise.resolve([]),
      appleSilicon: false,
    });

    expect(localEndpointRecord(resolved)).toEqual({
      type: "local-endpoint",
      actor: "harness",
      provenance: ["user"],
      payload: {
        chosen: "pinned",
        url: "http://10.0.0.5:11434/v1",
        origin: "flag",
        reason: "pinned by flag",
      },
    });
  });

  it("records a discovered endpoint as a probe result, models and all", async () => {
    const resolved = await resolveLocalEndpoint({
      pinned: null,
      discover: () => Promise.resolve([ollama, rapidMlx]),
      appleSilicon: true,
    });

    const entry = localEndpointRecord(resolved);
    expect(entry.type).toBe("local-endpoint");
    expect(entry.provenance).toEqual(["tool-output"]);
    expect(entry.payload).toMatchObject({
      chosen: "discovered",
      url: rapidMlx.baseUrl,
      runtime: "rapid-mlx",
      models: ["glm47-flash-abl"],
    });
    expect(entry.payload.reason).toMatch(/Apple Silicon/);
  });
});
