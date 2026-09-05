import { describe, expect, it } from "vitest";
import { MalformedSwarmTomlError, parseSwarmToml } from "./swarm-toml.ts";

/**
 * swarm.toml sits in the repository, so anything in it is repository-controlled: it is
 * committed, it is cloned, it is diffed, and a run against a repository somebody else wrote
 * reads whatever that repository put there. A provider key does not belong in a file with
 * those properties, and a warning that leaves it working preserves the assurance it breaks.
 */
describe("a provider credential in repository-controlled configuration", () => {
  for (const key of ["anthropic_api_key", "openai_api_key", "google_api_key"]) {
    it(`refuses ${key} rather than reading it`, () => {
      expect(() =>
        parseSwarmToml(`[providers]\n${key} = "sk-not-a-real-key"\n`, "swarm.toml"),
      ).toThrow(MalformedSwarmTomlError);
    });

    it(`tells the reader where the key goes instead, and to rotate this one`, () => {
      let message = "";
      try {
        parseSwarmToml(`[providers]\n${key} = "sk-not-a-real-key"\n`, "swarm.toml");
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toMatch(/rotate/i);
      expect(message).toMatch(/environment/i);
    });
  }

  it("still reads the settings that are not credentials", () => {
    const parsed = parseSwarmToml(
      '[providers]\nlocal_endpoint = "http://127.0.0.1:11434/v1"\nlocal_thinking = false\n',
      "swarm.toml",
    );

    expect(parsed.providers.localEndpoint).toBe("http://127.0.0.1:11434/v1");
    expect(parsed.providers.localThinking).toBe(false);
  });
});
