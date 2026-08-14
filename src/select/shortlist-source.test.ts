import { describe, expect, it } from "vitest";
import { MalformedShortlistError } from "./shortlist.ts";
import {
  defaultShortlistUrl,
  loadShortlist,
  type ShortlistFetch,
  type ShortlistSource,
  ShortlistUnavailableError,
} from "./shortlist-source.ts";

const published = JSON.stringify({
  schemaVersion: 1,
  revision: "2026-09-01",
  backends: [
    {
      name: "ollama",
      label: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      install: "ollama pull {model}",
      serve: "ollama serve",
    },
  ],
  tiers: [
    {
      id: "t",
      label: "t",
      rank: 1,
      minRamGb: 0,
      minVramGb: null,
      appleSilicon: null,
      models: [
        {
          id: "m",
          backend: "ollama",
          parameters: "7B",
          quantization: "Q4_K_M",
          diskGb: 1,
          residentGb: 1,
          contextWindow: 8192,
        },
      ],
    },
  ],
});

function serving(body: string): ShortlistFetch {
  return () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
}

const refusing: ShortlistFetch = () => Promise.reject(new Error("ECONNREFUSED"));

function source(overrides: Partial<ShortlistSource> = {}): ShortlistSource {
  return {
    fetch: serving(published),
    readFile: () => Promise.reject(new Error("no file was expected")),
    requested: null,
    ...overrides,
  };
}

describe("loadShortlist with nothing pinned", () => {
  it("takes the list the project publishes", async () => {
    const loaded = await loadShortlist(source());

    expect(loaded).toMatchObject({
      origin: "published",
      location: defaultShortlistUrl,
      fallbackReason: null,
    });
    expect(loaded.shortlist.revision).toBe("2026-09-01");
  });

  it("falls back to the snapshot that shipped when the network is not there, and says why", async () => {
    const loaded = await loadShortlist(source({ fetch: refusing }));

    expect(loaded.origin).toBe("bundled");
    expect(loaded.fallbackReason).toMatch(/ECONNREFUSED/);
  });

  it("falls back when the URL answers with an error status, naming the status", async () => {
    const loaded = await loadShortlist(
      source({
        fetch: () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") }),
      }),
    );

    expect(loaded.origin).toBe("bundled");
    expect(loaded.fallbackReason).toMatch(/404/);
  });

  it("refuses malformed published data rather than quietly using the snapshot", async () => {
    // Unreachable and wrong are different failures: one is an absence, the other is a defect,
    // and silently swapping in older data would hide a broken publish.
    await expect(
      loadShortlist(source({ fetch: serving('{"schemaVersion":1,"tiers":"lots"}') })),
    ).rejects.toThrow(MalformedShortlistError);
  });
});

describe("loadShortlist with a shortlist pinned", () => {
  it("uses the bundled snapshot on request, without touching the network", async () => {
    let calls = 0;
    const loaded = await loadShortlist(
      source({
        requested: "bundled",
        fetch: () => {
          calls += 1;
          return Promise.reject(new Error("the bundled snapshot needs no network"));
        },
      }),
    );

    expect(loaded.origin).toBe("bundled");
    expect(loaded.fallbackReason).toBeNull();
    expect(calls).toBe(0);
  });

  it("reads a file the user pinned", async () => {
    const loaded = await loadShortlist(
      source({
        requested: "/etc/swarm/shortlist.json",
        readFile: (path) =>
          path === "/etc/swarm/shortlist.json"
            ? Promise.resolve(published)
            : Promise.reject(new Error(`unexpected read of ${path}`)),
      }),
    );

    expect(loaded).toMatchObject({
      origin: "file",
      location: "/etc/swarm/shortlist.json",
      fallbackReason: null,
    });
  });

  it("says what it could not read when the pinned file is not there", async () => {
    await expect(
      loadShortlist(
        source({
          requested: "/nope.json",
          readFile: () => Promise.reject(new Error("ENOENT: no such file")),
        }),
      ),
    ).rejects.toThrow(/\/nope\.json.*ENOENT/s);
  });

  it("does not fall back on a URL the user pinned, because they asked for that one", async () => {
    const pinned = loadShortlist(
      source({ requested: "https://example.test/s.json", fetch: refusing }),
    );

    await expect(pinned).rejects.toThrow(ShortlistUnavailableError);
    await expect(pinned).rejects.toThrow(/https:\/\/example\.test\/s\.json/);
  });

  it("fetches a URL the user pinned", async () => {
    const loaded = await loadShortlist(source({ requested: "https://example.test/s.json" }));

    expect(loaded).toMatchObject({ origin: "published", location: "https://example.test/s.json" });
  });
});
