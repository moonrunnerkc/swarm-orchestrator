import { describe, expect, it } from "vitest";
import { MalformedAgentConfigError, parseAgentConfig } from "./agent-config.ts";

describe("the [agent] table of swarm.toml", () => {
  it("reads the agent settings and ignores the verifier's tables", () => {
    const parsed = parseAgentConfig(
      [
        "[checks]",
        'test = "npm test"',
        "[agent]",
        'endpoint = "http://localhost:11434/v1"',
        'api_key_env = "OPENAI_API_KEY"',
        "max_steps = 40",
      ].join("\n"),
      "swarm.toml",
    );
    expect(parsed).toMatchObject({
      endpoint: "http://localhost:11434/v1",
      maxSteps: 40,
      apiKeyEnv: "OPENAI_API_KEY",
      maxTokens: null,
      turnTokens: null,
    });
  });

  it("reads a file with no [agent] table as no settings", () => {
    expect(parseAgentConfig('[checks]\ntest = "npm test"\n', "swarm.toml").model).toBeNull();
  });

  it("refuses a key written into the committed file", () => {
    expect(() => parseAgentConfig('[agent]\napi_key = "sk-live"', "swarm.toml")).toThrow(
      MalformedAgentConfigError,
    );
  });

  it("names the line of broken TOML", () => {
    expect(() => parseAgentConfig("[agent\n", "swarm.toml")).toThrow(/line 1/);
  });
});
