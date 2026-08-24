import { describe, expect, it } from "vitest";
import { chooseUsableModel, NoUsableModelError } from "./model-fallback.ts";
import type { LocalModelPreflight } from "./model-preflight.ts";

const noKeys = { anthropic: undefined, openai: undefined, google: undefined };

function preflightWhere(
  requested: string,
  outcome: "served" | "not-served" | "not-enumerated",
  served: readonly string[] | null,
): LocalModelPreflight {
  return {
    backendUrl: "http://127.0.0.1:8000/v1",
    endpoint: "http://127.0.0.1:8000/v1",
    served,
    failure: null,
    resolutions: [
      outcome === "served"
        ? { modelSpec: requested, outcome, servedId: "x", matchedBy: "id" }
        : { modelSpec: requested, outcome },
    ],
    runnable: outcome === "not-served" ? [] : [requested],
    excluded: outcome === "not-served" ? [requested] : [],
  };
}

describe("choosing a model the backend will actually answer for", () => {
  it("leaves a frontier model alone, since there is no backend to ask", () => {
    const chosen = chooseUsableModel({
      requested: "anthropic:claude-opus-5",
      preflight: null,
      keys: noKeys,
      candidates: [],
    });

    expect(chosen).toMatchObject({ outcome: "as-requested", modelSpec: "anthropic:claude-opus-5" });
  });

  it("runs the routed model when the backend says it serves it", () => {
    const chosen = chooseUsableModel({
      requested: "local:qwen3.5:27b",
      preflight: preflightWhere("local:qwen3.5:27b", "served", ["qwen3.5:27b"]),
      keys: noKeys,
      candidates: [],
    });

    expect(chosen.outcome).toBe("as-requested");
  });

  /**
   * The defect this covers, seen on a real machine: a calibration measured Ollama's models,
   * discovery preferred rapid-mlx, and the router handed over a name that endpoint had never
   * heard of. Three dispatches answered `Not Found` and the run stopped at zero steps.
   */
  it("substitutes the served model when the routed one is not served", () => {
    const chosen = chooseUsableModel({
      requested: "local:qwen3.5:27b",
      preflight: preflightWhere("local:qwen3.5:27b", "not-served", ["qwen3-coder:30b-a3b"]),
      keys: noKeys,
      candidates: [],
    });

    expect(chosen).toMatchObject({
      outcome: "substituted",
      modelSpec: "local:qwen3-coder:30b-a3b",
      requested: "local:qwen3.5:27b",
    });
  });

  it("prefers a served model a calibration measured over an arbitrary served one", () => {
    const chosen = chooseUsableModel({
      requested: "local:qwen3.5:27b",
      preflight: preflightWhere("local:qwen3.5:27b", "not-served", ["gemma4:31b", "other:1b"]),
      keys: noKeys,
      candidates: ["local:gemma4:31b"],
    });

    expect(chosen.modelSpec).toBe("local:gemma4:31b");
  });

  /** Local costs nothing and is what was asked for, so it wins over a key that would bill. */
  it("takes a served local model over a frontier key", () => {
    const chosen = chooseUsableModel({
      requested: "local:qwen3.5:27b",
      preflight: preflightWhere("local:qwen3.5:27b", "not-served", ["qwen3-coder:30b-a3b"]),
      keys: { ...noKeys, anthropic: "sk-test" },
      candidates: [],
    });

    expect(chosen.modelSpec).toBe("local:qwen3-coder:30b-a3b");
  });

  it("falls back to a frontier provider whose key is set when no local model can serve", () => {
    const chosen = chooseUsableModel({
      requested: "local:qwen3.5:27b",
      preflight: preflightWhere("local:qwen3.5:27b", "not-served", []),
      keys: { ...noKeys, openai: "sk-test" },
      candidates: [],
    });

    expect(chosen).toMatchObject({ outcome: "substituted", modelSpec: "openai:gpt-5.2" });
  });

  /**
   * An unanswered probe is not a backend serving nothing. Excluding on no evidence would
   * route around a model that works, which is the opposite of the defect this exists for.
   */
  it("changes nothing when the backend could not be asked", () => {
    const chosen = chooseUsableModel({
      requested: "local:qwen3.5:27b",
      preflight: preflightWhere("local:qwen3.5:27b", "not-enumerated", null),
      keys: { ...noKeys, anthropic: "sk-test" },
      candidates: [],
    });

    expect(chosen.outcome).toBe("as-requested");
  });

  it("says what is served and which keys would help when nothing can run", () => {
    expect(() =>
      chooseUsableModel({
        requested: "local:qwen3.5:27b",
        preflight: preflightWhere("local:qwen3.5:27b", "not-served", ["qwen3-coder:30b-a3b"]),
        keys: noKeys,
        candidates: [],
      }),
    ).not.toThrow();

    expect(() =>
      chooseUsableModel({
        requested: "local:qwen3.5:27b",
        preflight: preflightWhere("local:qwen3.5:27b", "not-served", []),
        keys: noKeys,
        candidates: [],
      }),
    ).toThrow(NoUsableModelError);
  });
});
