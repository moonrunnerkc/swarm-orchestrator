import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Swarm Orchestrator is the coding agent and Swarm Verify the standalone verifier it consumes
 * (ADR 0015). Their identities inverted twice: in the 14.3.0 README, and in 15.0.0, whose
 * README was headed swarm-verify while the verifier's source lived here. This holds the front
 * matter to the agent, and the verifier to an installed dependency reached only through its
 * public exports.
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
  readonly workspaces?: unknown;
}

const orchestrator = JSON.parse(read("package.json")) as Manifest;

function sourceFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("the agent and the verifier it consumes", () => {
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

  it("depends on one exact swarm-verify version, with no workspace copy of it", () => {
    expect(orchestrator.dependencies["swarm-verify"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(orchestrator.workspaces).toBeUndefined();
    expect(existsSync(join(root, "packages"))).toBe(false);
    expect(existsSync(join(root, "src", "verify"))).toBe(false);
  });

  it("reaches the verifier only through its package exports", () => {
    const allowed = new Set(["swarm-verify", "swarm-verify/cli", "swarm-verify/execution"]);
    const crossings: string[] = [];
    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/from\s+"(swarm-verify[^"]*)"/g)) {
        const specifier = match[1] ?? "";
        if (!allowed.has(specifier)) crossings.push(`${file}: ${specifier}`);
      }
      if (/from\s+"[./]+(?:verify|exec)\//.test(text))
        crossings.push(`${file}: a relative verifier path`);
    }
    expect(crossings).toEqual([]);
  });

  it("ships its own changelog, which points at the verifier's", () => {
    expect(orchestrator.files).toContain("CHANGELOG.md");
    const changelog = read("CHANGELOG.md");
    expect(changelog.startsWith("# Changelog: swarm-orchestrator\n")).toBe(true);
    expect(changelog).toContain("moonrunnerkc/swarm-verify");
    expect(changelog).not.toMatch(/^## 1\.\d+\.\d+ /m);
  });
});
