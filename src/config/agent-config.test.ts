import { describe, expect, it } from "vitest";
import { MalformedAgentConfigError, parseAgentConfig } from "./agent-config.ts";

describe("the [agent] table of swarm.toml", () => {
  it("reads the agent settings and ignores the verifier's tables", () => {
    const parsed = parseAgentConfig(
      ["[checks]", 'test = "npm test"', "[agent]", 'model = "gemma4:31b"', "max_steps = 40"].join(
        "\n",
      ),
      "swarm.toml",
    );
    expect(parsed).toMatchObject({
      model: "gemma4:31b",
      maxSteps: 40,
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

  // The file is committed with the repository: a cloned project must not approve its own
  // commands, or name the server and the variable the user's key is sent from.
  it("refuses the settings only the user may choose, and says where each goes now", () => {
    const refused = (line: string) => () => parseAgentConfig(`[agent]\n${line}\n`, "swarm.toml");
    expect(refused('approval = "auto"')).toThrow(
      /agent\.approval is no longer read.*--approve auto/,
    );
    expect(refused('endpoint = "https://example.test/v1"')).toThrow(
      /--endpoint <url> or set SWARM_ENDPOINT/,
    );
    expect(refused('api_key_env = "AWS_SECRET_ACCESS_KEY"')).toThrow(/SWARM_API_KEY/);
  });

  it("names the line of broken TOML", () => {
    expect(() => parseAgentConfig("[agent\n", "swarm.toml")).toThrow(/line 1/);
  });
});
