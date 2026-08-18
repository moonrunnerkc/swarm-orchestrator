import { describe, expect, it } from "vitest";
import type { ServedModelList } from "../providers/served-models.ts";
import { describePreflight, preflightLocalModels, preflightRecord } from "./model-preflight.ts";

const endpoint = "http://127.0.0.1:8000/v1/models";
const backendUrl = "http://127.0.0.1:8000/v1";

function serving(
  models: readonly { id: string; root?: string; parent?: string }[],
): ServedModelList {
  return {
    endpoint,
    enumerated: true,
    models: models.map((model) => ({
      id: model.id,
      root: model.root ?? null,
      parent: model.parent ?? null,
    })),
  };
}

const unreachable: ServedModelList = {
  endpoint,
  enumerated: false,
  failure: "it could not be reached: connect ECONNREFUSED",
};

function preflight(requested: readonly string[], list: ServedModelList) {
  return preflightLocalModels({ requested, backendUrl, list });
}

describe("preflightLocalModels", () => {
  it("resolves a local model the backend serves under exactly that id", () => {
    const checked = preflight(["local:served-alias"], serving([{ id: "served-alias" }]));

    expect(checked.resolutions[0]).toEqual({
      modelSpec: "local:served-alias",
      outcome: "served",
      servedId: "served-alias",
      matchedBy: "id",
    });
    expect(checked.runnable).toEqual(["local:served-alias"]);
    expect(checked.excluded).toEqual([]);
  });

  /**
   * The failure this was written for: calibration was handed two local model ids, the backend
   * held one of them under a server-assigned alias, and every dispatch for the other one was
   * refused. Excluding it here is what keeps those refusals from being recorded as runs.
   */
  it("excludes a requested model the backend does not serve", () => {
    const checked = preflight(
      ["local:served-alias", "local:vendor/Model-Weights-8bit"],
      serving([{ id: "served-alias" }]),
    );

    expect(checked.excluded).toEqual(["local:vendor/Model-Weights-8bit"]);
    expect(checked.runnable).toEqual(["local:served-alias"]);
    expect(checked.resolutions[1]).toEqual({
      modelSpec: "local:vendor/Model-Weights-8bit",
      outcome: "not-served",
    });
  });

  it("resolves through the mapping the backend publishes between its alias and the model path", () => {
    const checked = preflight(
      ["local:vendor/Model-Weights-8bit"],
      serving([{ id: "served-alias", root: "vendor/Model-Weights-8bit" }]),
    );

    expect(checked.resolutions[0]).toMatchObject({
      outcome: "served",
      servedId: "served-alias",
      matchedBy: "backend-mapping",
    });
  });

  it("reads a parent as that mapping too, since the protocol offers both", () => {
    const checked = preflight(
      ["local:vendor/Model-Weights-8bit"],
      serving([{ id: "served-alias", parent: "vendor/Model-Weights-8bit" }]),
    );

    expect(checked.resolutions[0]).toMatchObject({
      outcome: "served",
      matchedBy: "backend-mapping",
    });
  });

  /**
   * Two names that share a word are two names. A prefix, a suffix, or a shared vendor is not
   * a mapping the backend published, and dispatching on one would send the run to a model
   * nobody asked for while reporting it under the name that was asked for.
   */
  it("never matches on a substring, a prefix, or a shared vendor", () => {
    for (const requested of [
      "local:vendor/Model-Weights",
      "local:Model-Weights-8bit",
      "local:vendor/Model-Weights-8bit-extra",
      "local:VENDOR/MODEL-WEIGHTS-8BIT",
    ]) {
      const checked = preflight([requested], serving([{ id: "vendor/Model-Weights-8bit" }]));
      expect(checked.excluded).toEqual([requested]);
    }
  });

  it("leaves a frontier model alone, since no local backend answers for it", () => {
    const checked = preflight(["anthropic:some-frontier-id"], serving([]));

    expect(checked.resolutions[0]).toEqual({
      modelSpec: "anthropic:some-frontier-id",
      outcome: "not-local",
    });
    expect(checked.runnable).toEqual(["anthropic:some-frontier-id"]);
  });

  it("excludes nothing when the backend could not say what it serves", () => {
    const checked = preflight(["local:a", "local:b"], unreachable);

    expect(checked.runnable).toEqual(["local:a", "local:b"]);
    expect(checked.served).toBeNull();
    expect(checked.resolutions.map((one) => one.outcome)).toEqual([
      "not-enumerated",
      "not-enumerated",
    ]);
  });

  it("excludes every local model when the backend says it is serving nothing", () => {
    const checked = preflight(["local:a"], serving([]));

    expect(checked.runnable).toEqual([]);
    expect(checked.served).toEqual([]);
  });
});

describe("preflightRecord", () => {
  it("records the backend, the endpoint, what it served, and the outcome per model", () => {
    const record = preflightRecord(
      preflight(
        ["local:served-alias", "local:vendor/Model-Weights-8bit"],
        serving([{ id: "served-alias" }]),
      ),
    );

    expect(record.type).toBe("calibration-preflight");
    expect(record.provenance).toEqual(["tool-output"]);
    expect(record.payload).toMatchObject({
      backend: backendUrl,
      endpoint,
      enumerated: true,
      served: ["served-alias"],
      failure: null,
      requested: ["local:served-alias", "local:vendor/Model-Weights-8bit"],
      runnable: ["local:served-alias"],
      excluded: ["local:vendor/Model-Weights-8bit"],
      models: [
        { model: "local:served-alias", outcome: "served", servedId: "served-alias" },
        { model: "local:vendor/Model-Weights-8bit", outcome: "not-served", servedId: null },
      ],
    });
  });

  it("records the reason the backend could not be asked, rather than an empty served list", () => {
    const record = preflightRecord(preflight(["local:a"], unreachable));

    expect(record.payload).toMatchObject({
      enumerated: false,
      served: null,
      failure: "it could not be reached: connect ECONNREFUSED",
      excluded: [],
    });
  });
});

describe("describePreflight", () => {
  it("names the model, the backend address, and what the backend reported as served", () => {
    const printed = describePreflight(
      preflight(
        ["local:served-alias", "local:vendor/Model-Weights-8bit"],
        serving([{ id: "served-alias" }]),
      ),
    ).join("\n");

    expect(printed).toContain("local:vendor/Model-Weights-8bit is not served by");
    expect(printed).toContain(backendUrl);
    expect(printed).toContain("reports serving served-alias");
    expect(printed).toContain("continuing with 1 of 2 model(s) asked for");
  });

  it("says nothing about exclusions when the backend could not be asked", () => {
    const printed = describePreflight(preflight(["local:a"], unreachable)).join("\n");

    expect(printed).toContain("could not say what it serves");
    expect(printed).toContain("nothing was excluded on its word");
  });

  it("stays quiet when every model asked for is served", () => {
    expect(describePreflight(preflight(["local:a"], serving([{ id: "a" }])))).toEqual([]);
  });
});
