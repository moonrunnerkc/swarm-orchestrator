import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Two products ship from this tree: Swarm Orchestrator, the coding agent, from the root
 * package, and Swarm Verify, the standalone verifier, from packages/swarm-verify. Their
 * identities inverted once, in the 14.3.0 README and the repository description, with the
 * agent described as an optional beta of the verifier it is built on. This holds the front
 * matter of each product to what it is, and the package metadata to the product it names, so
 * the inversion cannot return quietly through a documentation edit.
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

/** The phrases of the inversion, which no current product document may carry. */
const inverted = [
  /optional beta coding agent/i,
  /advanced beta/i,
  /main source repository for Swarm Verify/i,
  /Falsifying Swarm Orchestrator/i,
];

describe("the two products' identities", () => {
  it("names the root package as the coding agent and its binary as swarm", () => {
    expect(orchestrator.name).toBe("swarm-orchestrator");
    expect(orchestrator.bin).toEqual({ swarm: "dist/cli.js" });
    expect(orchestrator.description).toMatch(/coding agent/i);
    expect(orchestrator.homepage).toBe("https://github.com/moonrunnerkc/swarm-orchestrator#readme");
  });

  it("names the verifier package as the standalone verifier and its binary as swarm-verify", () => {
    expect(verifier.name).toBe("swarm-verify");
    expect(verifier.bin).toEqual({ "swarm-verify": "dist/swarm-verify.js" });
    expect(verifier.description).toMatch(/^Independent verification/);
    expect(verifier.description).not.toMatch(/beta/i);
    expect(verifier.homepage).toBe("https://github.com/moonrunnerkc/swarm-verify#readme");
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

  it("ships each product's own changelog with it", () => {
    expect(orchestrator.files).toContain("CHANGELOG.md");
    expect(verifier.files).toContain("CHANGELOG.md");
    expect(read("CHANGELOG.md").startsWith("# Changelog: swarm-orchestrator\n")).toBe(true);
    expect(
      read("packages/swarm-verify/CHANGELOG.md").startsWith("# Changelog: swarm-verify\n"),
    ).toBe(true);
    expect(read("packages/swarm-verify/CHANGELOG.md")).toMatch(/^## 1\.\d+\.\d+/m);
    expect(read("CHANGELOG.md")).not.toMatch(/^## 1\.\d+\.\d+ /m);
  });

  it("opens the repository README with Swarm Orchestrator, the coding agent", () => {
    const readme = read("README.md");
    const heading = /<h1>([^<]+)<\/h1>|^# (.+)$/m.exec(readme);
    expect(heading?.[1] ?? heading?.[2]).toBe("Swarm Orchestrator");
    expect(readme.indexOf("Swarm Orchestrator")).toBeLessThan(readme.indexOf("Swarm Verify"));
    expect(readme).toMatch(/coding agent/);
    for (const phrase of inverted) {
      expect(readme).not.toMatch(phrase);
    }
  });

  it("opens the verifier README with Swarm Verify, standing on its own", () => {
    const readme = read("packages/swarm-verify/README.md");
    expect(readme.startsWith("# Swarm Verify\n")).toBe(true);
    expect(readme).toContain("npx swarm-verify");
    expect(readme).toMatch(/No model, no API key/);
    for (const phrase of inverted) {
      expect(readme).not.toMatch(phrase);
    }
  });

  it("keeps the inversion out of the documents a reader is pointed at", () => {
    for (const path of ["docs/README.md", "docs/agent.md", "docs/verify-only.md", "SUPPORT.md"]) {
      for (const phrase of inverted) {
        expect({ path, text: read(path) }).not.toMatchObject({
          text: expect.stringMatching(phrase),
        });
      }
    }
  });
});
