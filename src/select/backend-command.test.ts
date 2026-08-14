import { describe, expect, it } from "vitest";
import { formatBackendCommands } from "./backend-command.ts";
import type { ShortlistBackend } from "./shortlist.ts";

const rapidMlx: ShortlistBackend = {
  name: "rapid-mlx",
  label: "rapid-mlx",
  baseUrl: "http://127.0.0.1:8000/v1",
  install: "rapid-mlx pull {model}",
  serve: "rapid-mlx serve --model {model} --port 8000",
};

describe("formatBackendCommands", () => {
  it("puts the model id everywhere the backend asked for it", () => {
    expect(
      formatBackendCommands(rapidMlx, "mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit"),
    ).toEqual({
      install: "rapid-mlx pull mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit",
      serve: "rapid-mlx serve --model mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit --port 8000",
    });
  });

  it("leaves a command that names no model alone", () => {
    const ollama: ShortlistBackend = {
      name: "ollama",
      label: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      install: "ollama pull {model}",
      serve: "ollama serve",
    };

    expect(formatBackendCommands(ollama, "qwen3-coder:30b-a3b")).toEqual({
      install: "ollama pull qwen3-coder:30b-a3b",
      serve: "ollama serve",
    });
  });

  it("does not let a model id containing the placeholder rewrite the command twice", () => {
    // Substitution runs once over the template, not repeatedly over its own output.
    expect(formatBackendCommands(rapidMlx, "{model}").install).toBe("rapid-mlx pull {model}");
  });
});
