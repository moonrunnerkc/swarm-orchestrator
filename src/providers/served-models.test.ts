import { describe, expect, it } from "vitest";
import { fetchServedModels, servedModelsEndpoint } from "./served-models.ts";

function answering(body: unknown, status = 200) {
  return () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
}

describe("servedModelsEndpoint", () => {
  it("asks the OpenAI-compatible list route under the base url the provider dispatches to", () => {
    expect(servedModelsEndpoint("http://127.0.0.1:8000/v1")).toBe(
      "http://127.0.0.1:8000/v1/models",
    );
  });

  it("does not double the separator when the base url carries a trailing slash", () => {
    expect(servedModelsEndpoint("http://127.0.0.1:11434/v1/")).toBe(
      "http://127.0.0.1:11434/v1/models",
    );
  });
});

describe("fetchServedModels", () => {
  it("reads the ids the backend reports", async () => {
    const list = await fetchServedModels({
      baseUrl: "http://127.0.0.1:8000/v1",
      fetch: answering({ object: "list", data: [{ id: "served-alias" }] }),
    });

    expect(list).toMatchObject({
      enumerated: true,
      endpoint: "http://127.0.0.1:8000/v1/models",
      models: [{ id: "served-alias", root: null, parent: null }],
    });
  });

  it("carries the mapping fields when the backend publishes them", async () => {
    const list = await fetchServedModels({
      baseUrl: "http://127.0.0.1:8000/v1",
      fetch: answering({
        data: [{ id: "served-alias", root: "vendor/Model-Weights-8bit", parent: null }],
      }),
    });

    expect(list.enumerated && list.models[0]).toMatchObject({
      id: "served-alias",
      root: "vendor/Model-Weights-8bit",
    });
  });

  /**
   * The three ways of not knowing, each kept apart from a backend that serves nothing. An
   * empty list is a statement, and turning a timeout or a 401 into one would exclude every
   * model asked for on the strength of a probe that never got an answer.
   */
  it("reports a refused status as a failure rather than as an empty list", async () => {
    const list = await fetchServedModels({
      baseUrl: "http://127.0.0.1:8000/v1",
      fetch: answering({}, 401),
    });

    expect(list.enumerated).toBe(false);
    expect(list.enumerated === false && list.failure).toMatch(/401/);
  });

  it("reports an unreachable backend as a failure", async () => {
    const list = await fetchServedModels({
      baseUrl: "http://127.0.0.1:8000/v1",
      fetch: () => Promise.reject(new Error("connect ECONNREFUSED")),
    });

    expect(list.enumerated).toBe(false);
    expect(list.enumerated === false && list.failure).toMatch(/ECONNREFUSED/);
  });

  it("reports a body that is not a model list as a failure", async () => {
    const list = await fetchServedModels({
      baseUrl: "http://127.0.0.1:8000/v1",
      fetch: answering({ detail: "Not Found" }),
    });

    expect(list.enumerated).toBe(false);
    expect(list.enumerated === false && list.failure).toMatch(/not an OpenAI-compatible/);
  });

  it("reports a backend serving nothing as an empty list, which is a statement", async () => {
    const list = await fetchServedModels({
      baseUrl: "http://127.0.0.1:8000/v1",
      fetch: answering({ data: [] }),
    });

    expect(list).toMatchObject({ enumerated: true, models: [] });
  });
});
