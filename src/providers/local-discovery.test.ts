import { describe, expect, it } from "vitest";
import {
  defaultLocalEndpoints,
  discoverLocalEndpoints,
  type FetchLike,
} from "./local-discovery.ts";

function respondWith(byUrl: Record<string, unknown>): FetchLike {
  return (url) => {
    const body = byUrl[url];
    if (body === undefined) {
      return Promise.reject(new Error(`ECONNREFUSED ${url}`));
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };
}

describe("local endpoint discovery", () => {
  it("probes the Ollama and rapid-mlx default ports", () => {
    expect(defaultLocalEndpoints).toEqual([
      { name: "ollama", baseUrl: "http://127.0.0.1:11434/v1" },
      { name: "rapid-mlx", baseUrl: "http://127.0.0.1:8000/v1" },
    ]);
  });

  it("lists the models a reachable runtime serves", async () => {
    const discovered = await discoverLocalEndpoints({
      fetch: respondWith({
        "http://127.0.0.1:11434/v1/models": {
          data: [{ id: "qwen3.6:35b-a3b" }, { id: "gemma4:e4b" }],
        },
      }),
    });

    expect(discovered).toEqual([
      {
        name: "ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
        models: ["qwen3.6:35b-a3b", "gemma4:e4b"],
      },
    ]);
  });

  it("leaves out a runtime that is not running", async () => {
    expect(await discoverLocalEndpoints({ fetch: respondWith({}) })).toEqual([]);
  });

  it("leaves out an endpoint whose response is not a model list", async () => {
    const discovered = await discoverLocalEndpoints({
      fetch: respondWith({ "http://127.0.0.1:8000/v1/models": { models: ["not-the-schema"] } }),
    });

    expect(discovered).toEqual([]);
  });

  it("leaves out an endpoint that answers with an error status", async () => {
    const discovered = await discoverLocalEndpoints({
      fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
    });

    expect(discovered).toEqual([]);
  });
});
