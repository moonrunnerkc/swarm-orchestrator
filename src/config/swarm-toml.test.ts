import { describe, expect, it } from "vitest";
import { MalformedSwarmTomlError, parseSwarmToml } from "./swarm-toml.ts";

describe("swarm.toml", () => {
  it("reads checks, the allowance and the agent settings", () => {
    const parsed = parseSwarmToml(
      [
        "[checks]",
        'test = "npm test"',
        'unit = { command = "node --test", kind = "test" }',
        'lint = "npm run lint"',
        "[protect]",
        'allow = ["tests"]',
        "[agent]",
        'endpoint = "http://localhost:11434/v1"',
        'api_key_env = "OPENAI_API_KEY"',
        "max_steps = 40",
      ].join("\n"),
      "swarm.toml",
    );
    expect(parsed.checks.map((check) => [check.name, check.kind])).toEqual([
      ["test", "test"],
      ["unit", "test"],
      ["lint", "other"],
    ]);
    expect(parsed.allow).toEqual(["tests"]);
    expect(parsed.agent).toMatchObject({
      maxSteps: 40,
      apiKeyEnv: "OPENAI_API_KEY",
      maxTokens: null,
    });
  });

  it("refuses a key written into the committed file", () => {
    expect(() => parseSwarmToml('[agent]\napi_key = "sk-live"', "swarm.toml")).toThrow(
      MalformedSwarmTomlError,
    );
  });

  it("names the line of broken TOML", () => {
    expect(() => parseSwarmToml("[checks\n", "swarm.toml")).toThrow(/line 1/);
  });
});
