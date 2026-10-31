import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Swarm Orchestrator is the coding agent and Swarm Verify the standalone verifier it consumes
 * (ADR 0015). Their identities inverted twice: in the 14.3.0 README, and in 15.0.0, whose
 * README was headed swarm-verify. This holds each product's front matter and package metadata
 * to what it is, so the inversion cannot return quietly through a documentation edit.
 */
const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

interface Manifest {
  readonly name: string;
  readonly description: string;
  readonly bin: Readonly<Record<string, string>>;
  readonly homepage: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly files: readonly string[];
  readonly repository: { readonly url: string; readonly directory?: string };
}

const orchestrator = JSON.parse(read("package.json")) as Manifest;
const verifier = JSON.parse(read("packages/swarm-verify/package.json")) as Manifest;

describe("the two products' identities", () => {
  it("heads the root README with the agent and its product promise", () => {
    const readme = read("README.md");
    expect(readme.startsWith("# swarm-orchestrator\n")).toBe(true);
    expect(readme).toMatch(
      /^Give Swarm an engineering task\. It makes the change, checks each requirement/m,
    );
  });

  it("names the root package as the coding agent and its binary as swarm", () => {
    expect(orchestrator.name).toBe("swarm-orchestrator");
    expect(orchestrator.bin).toEqual({ swarm: "dist/cli.js" });
    expect(orchestrator.description).toMatch(/coding agent/i);
    expect(orchestrator.description).not.toMatch(/judged by|refuse/i);
    expect(orchestrator.homepage).toBe("https://github.com/moonrunnerkc/swarm-orchestrator#readme");
  });

  it("names the verifier package as the standalone verifier, with its CLI and MCP binaries", () => {
    expect(verifier.name).toBe("swarm-verify");
    expect(verifier.bin).toEqual({
      "swarm-verify": "dist/swarm-verify.js",
      "swarm-verify-mcp": "mcp.mjs",
    });
    expect(verifier.description).toMatch(
      /^Measure a candidate change against a project's own checks/,
    );
    expect(verifier.description).toMatch(/in-toto/);
    expect(verifier.homepage).toBe(
      "https://github.com/moonrunnerkc/swarm-orchestrator/tree/v13-main/packages/swarm-verify#readme",
    );
  });

  it("builds the verifier from this tree, which its provenance record has to name", () => {
    expect(verifier.repository.url).toBe(
      "git+https://github.com/moonrunnerkc/swarm-orchestrator.git",
    );
    expect(verifier.repository.directory).toBe("packages/swarm-verify");
  });

  it("gives the verifier no model provider dependency", () => {
    expect(Object.keys(verifier.dependencies).sort()).toEqual(["smol-toml", "zod"]);
    for (const name of Object.keys(orchestrator.dependencies)) {
      if (name.startsWith("@ai-sdk/") || name === "ai") {
        expect(verifier.dependencies).not.toHaveProperty(name);
      }
    }
  });

  it("ships each product's own changelog, and the dependency-free checker with the verifier", () => {
    expect(verifier.files).toContain("verify.mjs");
    expect(orchestrator.files).toContain("CHANGELOG.md");
    expect(verifier.files).toContain("CHANGELOG.md");
    expect(read("CHANGELOG.md").startsWith("# Changelog: swarm-orchestrator\n")).toBe(true);
    expect(
      read("packages/swarm-verify/CHANGELOG.md").startsWith("# Changelog: swarm-verify\n"),
    ).toBe(true);
    expect(read("packages/swarm-verify/CHANGELOG.md")).toMatch(/^## 1\.\d+\.\d+/m);
    expect(read("CHANGELOG.md")).not.toMatch(/^## 1\.\d+\.\d+ /m);
  });
});
