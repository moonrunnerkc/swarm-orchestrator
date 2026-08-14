import { describe, expect, it } from "vitest";
import { resolveSettings } from "./settings.ts";
import { parseSwarmToml } from "./swarm-toml.ts";

const noFlags = { model: null, maxSteps: null, attempts: null, localEndpoint: null };

const toml = parseSwarmToml(
  [
    "[providers]",
    'anthropic_api_key = "toml-anthropic"',
    'local_endpoint = "http://127.0.0.1:9999/v1"',
    "[gates]",
    'tests = "npm run test:fast"',
    "[budgets]",
    "max_steps = 25",
    "attempts = 2",
    "max_added_lines = 200",
    "[models]",
    'pin = "local:toml-pinned"',
  ].join("\n"),
  "swarm.toml",
);

describe("resolveSettings precedence: flags over environment over swarm.toml over defaults", () => {
  it("lets a flag beat the environment, the file, and the default for the model", () => {
    const settings = resolveSettings({
      flags: { ...noFlags, model: "openai:from-flag" },
      env: { SWARM_MODEL: "google:from-env" },
      toml,
    });

    expect(settings.modelSpec).toBe("openai:from-flag");
    expect(settings.modelPinned).toBe(true);
  });

  it("lets the environment beat the file when no flag is given", () => {
    const settings = resolveSettings({
      flags: noFlags,
      env: { SWARM_MODEL: "google:from-env" },
      toml,
    });

    expect(settings.modelSpec).toBe("google:from-env");
    expect(settings.modelPinned).toBe(true);
  });

  it("lets the file beat the default when neither flag nor environment name a model", () => {
    const settings = resolveSettings({ flags: noFlags, env: {}, toml });

    expect(settings.modelSpec).toBe("local:toml-pinned");
    expect(settings.modelPinned).toBe(true);
  });

  it("falls back to the default model, unpinned, when nothing names one", () => {
    const settings = resolveSettings({ flags: noFlags, env: {}, toml: null });

    expect(settings.modelSpec).toBe("anthropic:claude-opus-5");
    expect(settings.modelPinned).toBe(false);
  });

  it("resolves budgets the same way: flag, then file, then default", () => {
    const flagged = resolveSettings({
      flags: { ...noFlags, maxSteps: 7, attempts: 1 },
      env: {},
      toml,
    });
    const fromFile = resolveSettings({ flags: noFlags, env: {}, toml });
    const defaulted = resolveSettings({ flags: noFlags, env: {}, toml: null });

    expect([flagged.maxSteps, flagged.attempts]).toEqual([7, 1]);
    expect([fromFile.maxSteps, fromFile.attempts]).toEqual([25, 2]);
    expect([defaulted.maxSteps, defaulted.attempts]).toEqual([40, 3]);
  });
});

describe("resolveSettings on the local endpoint", () => {
  it("keeps the origin with the url, so a ledger record can say how it was chosen", () => {
    const flagged = resolveSettings({
      flags: { ...noFlags, localEndpoint: "http://127.0.0.1:1111/v1" },
      env: { SWARM_LOCAL_BASE_URL: "http://127.0.0.1:2222/v1" },
      toml,
    });
    const fromEnv = resolveSettings({
      flags: noFlags,
      env: { SWARM_LOCAL_BASE_URL: "http://127.0.0.1:2222/v1" },
      toml,
    });
    const fromFile = resolveSettings({ flags: noFlags, env: {}, toml });

    expect(flagged.localEndpoint).toEqual({ url: "http://127.0.0.1:1111/v1", origin: "flag" });
    expect(fromEnv.localEndpoint).toEqual({
      url: "http://127.0.0.1:2222/v1",
      origin: "environment",
    });
    expect(fromFile.localEndpoint).toEqual({ url: "http://127.0.0.1:9999/v1", origin: "config" });
  });

  it("resolves to null when nothing names an endpoint, which is what discovery answers", () => {
    const settings = resolveSettings({ flags: noFlags, env: {}, toml: null });

    expect(settings.localEndpoint).toBeNull();
  });
});

describe("resolveSettings on provider keys and gate overrides", () => {
  it("prefers a key from the environment over one from the file", () => {
    const settings = resolveSettings({
      flags: noFlags,
      env: { ANTHROPIC_API_KEY: "env-anthropic", OPENAI_API_KEY: "env-openai" },
      toml,
    });

    expect(settings.providerKeys.anthropic).toBe("env-anthropic");
    expect(settings.providerKeys.openai).toBe("env-openai");
    expect(settings.providerKeys.google).toBeUndefined();
  });

  it("takes a key from the file when the environment has none", () => {
    const settings = resolveSettings({ flags: noFlags, env: {}, toml });

    expect(settings.providerKeys.anthropic).toBe("toml-anthropic");
  });

  it("passes gate command overrides and the diff budget through from the file", () => {
    const settings = resolveSettings({ flags: noFlags, env: {}, toml });

    expect(settings.gateCommandOverrides).toEqual({ tests: "npm run test:fast" });
    expect(settings.diffBudget).toEqual({ maxAddedLines: 200 });
  });

  it("resolves to no overrides and no diff budget with no file at all", () => {
    const settings = resolveSettings({ flags: noFlags, env: {}, toml: null });

    expect(settings.gateCommandOverrides).toEqual({});
    expect(settings.diffBudget).toEqual({});
  });
});
