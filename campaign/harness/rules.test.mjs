import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readManifestFacts } from "./manifest-facts.mjs";
import { rejectionFromCheckout, rejectionFromSearch } from "./rules.mjs";

const scratch = [];
afterEach(async () => {
  for (const directory of scratch.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function checkout(files) {
  const root = await mkdtemp(join(tmpdir(), "rules-"));
  scratch.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

const acceptable = {
  fullName: "someone/thing",
  owner: "someone",
  language: "Go",
  stars: 300,
  license: "MIT",
  sizeKilobytes: 5000,
  archived: false,
  fork: false,
  template: false,
  mirror: false,
};

describe("the rules that read the search result", () => {
  it("accepts a candidate that fails none of them", () => {
    expect(rejectionFromSearch(acceptable)).toBeNull();
  });

  it("names the first rule failed, in the sealed order", () => {
    expect(rejectionFromSearch({ ...acceptable, archived: true, fork: true })).toBe("archived");
    expect(rejectionFromSearch({ ...acceptable, fork: true })).toBe("fork");
    expect(rejectionFromSearch({ ...acceptable, template: true })).toBe("template");
    expect(rejectionFromSearch({ ...acceptable, mirror: true })).toBe("mirror");
    expect(rejectionFromSearch({ ...acceptable, owner: "moonrunnerkc" })).toBe(
      "owner excluded: moonrunnerkc",
    );
    expect(rejectionFromSearch({ ...acceptable, language: "Haskell" })).toBe(
      "language outside the quotas: Haskell",
    );
    expect(rejectionFromSearch({ ...acceptable, license: "GPL-3.0" })).toBe("license: GPL-3.0");
    expect(rejectionFromSearch({ ...acceptable, license: null })).toBe("license: none reported");
    expect(rejectionFromSearch({ ...acceptable, sizeKilobytes: 300000 })).toBe(
      "repository size: 300000 kilobytes",
    );
  });
});

describe("the rules that read the checkout", () => {
  it("accepts a go repository with its manifest and a count inside the bounds", async () => {
    const root = await checkout({ "go.mod": "module example.com/thing\n\ngo 1.23\n" });

    const facts = await readManifestFacts(root);

    expect(facts.types).toEqual(["go"]);
    expect(rejectionFromCheckout(acceptable, facts, 1000)).toBeNull();
  });

  it("rejects a repository that configures the harness measuring it", async () => {
    const root = await checkout({ "go.mod": "module x\n", "swarm.toml": "" });

    expect(rejectionFromCheckout(acceptable, await readManifestFacts(root), 1000)).toBe(
      "carries swarm.toml",
    );
  });

  it("rejects a multi-package tree by whichever marker it carries", async () => {
    const pnpm = await checkout({
      "package.json": { scripts: { test: "vitest run" } },
      "pnpm-lock.yaml": "",
      "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
    });
    const cargo = await checkout({ "Cargo.toml": "[workspace]\nmembers = [\"a\"]\n" });
    const npm = await checkout({
      "package.json": { workspaces: ["packages/*"], scripts: { test: "vitest run" } },
      "package-lock.json": "{}",
    });
    const js = { ...acceptable, language: "JavaScript" };
    const rust = { ...acceptable, language: "Rust" };

    expect(rejectionFromCheckout(js, await readManifestFacts(pnpm), 1000)).toBe(
      "multi-package tree: pnpm-workspace.yaml",
    );
    expect(rejectionFromCheckout(rust, await readManifestFacts(cargo), 1000)).toBe(
      "multi-package tree: Cargo.toml [workspace]",
    );
    expect(rejectionFromCheckout(js, await readManifestFacts(npm), 1000)).toBe(
      "multi-package tree: package.json workspaces",
    );
  });

  it("rejects a suite that needs a service, by the dependency that says so", async () => {
    const node = await checkout({
      "package.json": { scripts: { test: "jest" }, devDependencies: { jest: "1", playwright: "1" } },
      "package-lock.json": "{}",
    });
    const python = await checkout({
      "pyproject.toml": '[project]\nname = "x"\n[project.optional-dependencies]\ndev = ["pytest", "pytest-docker>=1"]\n',
    });
    const go = await checkout({
      "go.mod": "module x\n\nrequire (\n\tgithub.com/testcontainers/testcontainers-go v0.30.0\n)\n",
    });

    expect(
      rejectionFromCheckout({ ...acceptable, language: "TypeScript" }, await readManifestFacts(node), 1000),
    ).toBe("needs a service: playwright");
    expect(
      rejectionFromCheckout({ ...acceptable, language: "Python" }, await readManifestFacts(python), 1000),
    ).toBe("needs a service: pytest-docker");
    expect(rejectionFromCheckout(acceptable, await readManifestFacts(go), 1000)).toBe(
      "needs a service: github.com/testcontainers/testcontainers-go",
    );
  });

  it("rejects the language's manifest being absent, and a node manifest that tests nothing", async () => {
    const noManifest = await checkout({ "README.md": "" });
    const noScript = await checkout({ "package.json": {}, "package-lock.json": "{}" });
    const placeholder = await checkout({
      "package.json": { scripts: { test: 'echo "Error: no test specified" && exit 1' } },
      "package-lock.json": "{}",
    });
    const noLock = await checkout({ "package.json": { scripts: { test: "jest" } }, "yarn.lock": "" });
    const js = { ...acceptable, language: "JavaScript" };

    expect(rejectionFromCheckout(acceptable, await readManifestFacts(noManifest), 1000)).toBe("no go.mod");
    expect(rejectionFromCheckout(js, await readManifestFacts(noScript), 1000)).toBe("no test script");
    expect(rejectionFromCheckout(js, await readManifestFacts(placeholder), 1000)).toBe(
      "placeholder test script",
    );
    expect(rejectionFromCheckout(js, await readManifestFacts(noLock), 1000)).toBe(
      "no lockfile the install recipe covers",
    );
  });

  it("rejects a count outside the bounds, and names the count", async () => {
    const root = await checkout({ "go.mod": "module x\n" });
    const facts = await readManifestFacts(root);

    expect(rejectionFromCheckout(acceptable, facts, 299)).toBe("lines: 299");
    expect(rejectionFromCheckout(acceptable, facts, 300)).toBeNull();
    expect(rejectionFromCheckout(acceptable, facts, 30000)).toBeNull();
    expect(rejectionFromCheckout(acceptable, facts, 30001)).toBe("lines: 30001");
  });
});
