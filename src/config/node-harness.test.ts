import { describe, expect, it } from "vitest";
import { hasAnyManifest, nodeHarnessFiles } from "./node-harness.ts";

/**
 * A workspace with no manifest is one no gate can measure, and the criteria are sealed from
 * the base commit before the model runs, so a manifest the model adds mid-run does not change
 * what measures it. The harness has to be there first. For a Node project the tool can create
 * it: package.json declaring node's own test runner, which the gates vouch for whole, and a
 * .gitignore for the one directory a Node project never commits.
 */
describe("the Node harness swarm can create in an empty repository", () => {
  it("declares node's own test runner and nothing that needs installing", () => {
    const files = nodeHarnessFiles("rental-scraper");
    const manifest = JSON.parse(files["package.json"] ?? "{}") as {
      name: string;
      type: string;
      scripts: Record<string, string>;
      dependencies?: unknown;
    };

    expect(manifest.name).toBe("rental-scraper");
    expect(manifest.type).toBe("module");
    expect(manifest.scripts.test).toBe("node --test");
    expect(manifest.dependencies).toBeUndefined();
    expect(files[".gitignore"]).toContain("node_modules/");
    expect(Object.keys(files).sort()).toEqual([".gitignore", "package.json"]);
  });

  it("names the package from the directory, in a form npm accepts", () => {
    const manifest = JSON.parse(nodeHarnessFiles("My Project!")["package.json"] ?? "{}") as {
      name: string;
    };

    expect(manifest.name).toBe("my-project");
  });
});

describe("whether a workspace has any manifest the gates read", () => {
  const readerOf = (present: readonly string[]) => (path: string) =>
    Promise.resolve(present.includes(path) ? "{}" : null);

  it("is true for any one of the four", async () => {
    for (const manifest of ["package.json", "pyproject.toml", "Cargo.toml", "go.mod"]) {
      expect(await hasAnyManifest(readerOf([manifest]))).toBe(true);
    }
  });

  it("is false for a directory holding source and nothing that declares it", async () => {
    expect(await hasAnyManifest(readerOf(["scraper.py", "README.md"]))).toBe(false);
  });
});
