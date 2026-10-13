import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeArmConfiguration } from "./workspace.mjs";

function workspace() {
  const directory = mkdtempSync(join(tmpdir(), "comparison-workspace-"));
  mkdirSync(join(directory, ".git/info"), { recursive: true });
  writeFileSync(join(directory, ".git/info/exclude"), "");
  return directory;
}

describe("what each arm is configured with", () => {
  it("gives opencode the pinned endpoint and model for every call, with Swarm's output cap", () => {
    const directory = workspace();
    writeArmConfiguration(directory, "opencode", "http://127.0.0.1:8000/v1", "qwen3.8:27b");
    const written = JSON.parse(readFileSync(join(directory, "opencode.json"), "utf8"));
    expect(written.model).toBe("rapidmlx/qwen3.8:27b");
    expect(written.small_model).toBe("rapidmlx/qwen3.8:27b");
    expect(written.provider.rapidmlx.options.baseURL).toBe("http://127.0.0.1:8000/v1");
    expect(written.provider.rapidmlx.models["qwen3.8:27b"]).toEqual({
      name: "qwen3.8:27b",
      tool_call: true,
      limit: { context: 131072, output: 8192 },
    });
    expect(written.permission).toEqual({ edit: "allow", bash: "allow", webfetch: "deny" });
    expect(readFileSync(join(directory, ".git/info/exclude"), "utf8")).toContain("opencode.json");
  });

  it("gives swarm the same endpoint with thinking off, outside the tracked tree", () => {
    const directory = workspace();
    writeArmConfiguration(directory, "swarm", "http://127.0.0.1:8000/v1", "qwen3.8:27b");
    expect(readFileSync(join(directory, "swarm.toml"), "utf8")).toBe(
      '[providers]\nlocal_endpoint = "http://127.0.0.1:8000/v1"\nlocal_thinking = false\n',
    );
    expect(readFileSync(join(directory, ".git/info/exclude"), "utf8")).toContain("swarm.toml");
  });
});
