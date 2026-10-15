import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";
import {
  browserCacheIn,
  prepareLaunchHome,
  sharedNpmCache,
  swarmConfigurationText,
  writeArmConfiguration,
} from "./workspace.mjs";

function workspace() {
  const directory = mkdtempSync(join(tmpdir(), "comparison-workspace-"));
  mkdirSync(join(directory, ".git/info"), { recursive: true });
  writeFileSync(join(directory, ".git/info/exclude"), "");
  return directory;
}

describe("what each arm is configured with", () => {
  it("gives opencode the pinned endpoint and model for every call, with Swarm's output cap and thinking off", () => {
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
      options: {
        enable_thinking: false,
        chat_template_kwargs: { enable_thinking: false },
        reasoning_effort: "none",
        top_p: 0.95,
      },
    });
    expect(written.permission).toEqual({ edit: "allow", bash: "allow", webfetch: "deny" });
    expect(readFileSync(join(directory, ".git/info/exclude"), "utf8")).toContain("opencode.json");
  });

  it("gives swarm the same endpoint with thinking off, and the task's test command as its tests gate", () => {
    const directory = workspace();
    const task = { id: "t", projectTest: ["npm", "run", "test-node"] };
    writeArmConfiguration(directory, "swarm", "http://127.0.0.1:8000/v1", "qwen3.8:27b", task);
    const text = readFileSync(join(directory, "swarm.toml"), "utf8");
    expect(text).toBe(
      '[providers]\nlocal_endpoint = "http://127.0.0.1:8000/v1"\nlocal_thinking = false\n\n[gates.tests]\ncommand = "npm run test-node"\n',
    );
    // What was written is what the product's own parser reads back.
    expect(parseToml(text)).toEqual({
      providers: { local_endpoint: "http://127.0.0.1:8000/v1", local_thinking: false },
      gates: { tests: { command: "npm run test-node" } },
    });
    expect(readFileSync(join(directory, ".git/info/exclude"), "utf8")).toContain("swarm.toml");
  });

  it("refuses to serialize a test command whose words a shell could read otherwise", () => {
    expect(() =>
      swarmConfigurationText("http://127.0.0.1:8000/v1", {
        id: "t",
        projectTest: ["sh", "-c", "npm test 2>/dev/null"],
      }),
    ).toThrow(/plain words/);
  });
});

describe("the mutable state a launch gets", () => {
  it("creates a fresh home with npm's store linked to the shared content-addressed cache", () => {
    const home = join(mkdtempSync(join(tmpdir(), "comparison-home-")), "child-home");
    const prepared = prepareLaunchHome(home);
    expect(prepared.home).toBe(home);
    expect(existsSync(home)).toBe(true);
    expect(lstatSync(join(home, ".npm/_cacache")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(home, ".npm/_cacache"))).toBe(join(sharedNpmCache, "_cacache"));
    expect(prepared.npmCache).toContain("content-addressed");
    expect(browserCacheIn(home)).toBe(false);
    // A home that is already there is not fresh, whatever is in it.
    expect(() => prepareLaunchHome(home)).toThrow(/must be fresh/);
  });

  it("recognizes a downloaded browser cache in a home", () => {
    const home = mkdtempSync(join(tmpdir(), "comparison-home-"));
    mkdirSync(join(home, "Library/Caches/ms-playwright"), { recursive: true });
    expect(browserCacheIn(home)).toBe(true);
  });
});
