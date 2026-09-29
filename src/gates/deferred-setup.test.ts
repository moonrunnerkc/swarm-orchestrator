import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isPlainRequirement,
  npmDeferredScripts,
  uvEditableProject,
  uvEnvironmentPython,
  uvSourceBuilds,
} from "./deferred-setup.ts";

let workspace = "";
beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-deferred-"));
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function installed(path: string): Promise<void> {
  await mkdir(join(workspace, path), { recursive: true });
  await writeFile(join(workspace, path, "package.json"), "{}\n");
}

describe("the install scripts npm ci --ignore-scripts left undone", () => {
  it("names installed dependencies the lockfile marks, and never the project or its workspaces", async () => {
    await writeFile(
      join(workspace, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { name: "fx", hasInstallScript: true },
          "packages/member": { name: "member", hasInstallScript: true },
          "node_modules/member": { resolved: "packages/member", link: true },
          "node_modules/better-sqlite3": { version: "12.4.1", hasInstallScript: true },
          "node_modules/a/node_modules/@scope/native": { hasInstallScript: true },
          "node_modules/fsevents": { optional: true, hasInstallScript: true },
          "node_modules/plain": { version: "1.0.0" },
          "node_modules/--nodedir=/tmp/evil": { hasInstallScript: true },
        },
      }),
    );
    await installed("node_modules/better-sqlite3");
    await installed("node_modules/a/node_modules/@scope/native");
    await installed("node_modules/plain");
    expect(await npmDeferredScripts(workspace)).toEqual({
      packages: ["@scope/native", "better-sqlite3"],
      refused: ["--nodedir=/tmp/evil"],
    });
  });

  it("names nothing for a lockfile without the marker or without a lockfile", async () => {
    expect(await npmDeferredScripts(workspace)).toEqual({ packages: [], refused: [] });
    await writeFile(
      join(workspace, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 1, dependencies: { x: { version: "1.0.0" } } }),
    );
    expect(await npmDeferredScripts(workspace)).toEqual({ packages: [], refused: [] });
  });
});

describe("the project uv sync --no-install-project left out", () => {
  const lock = (source: string) =>
    `version = 1\n\n[[package]]\nname = "tinypkg"\nversion = "0.1.0"\nsource = ${source}\n`;

  it("reads the editable project's declared build system", async () => {
    await writeFile(join(workspace, "uv.lock"), lock('{ editable = "." }'));
    await writeFile(
      join(workspace, "pyproject.toml"),
      '[project]\nname = "tinypkg"\n\n[build-system]\nrequires = ["hatchling>=1.27"]\nbuild-backend = "hatchling.build"\nbackend-path = ["tools"]\n',
    );
    expect(await uvEditableProject(workspace)).toEqual({
      kind: "editable",
      requires: ["hatchling>=1.27"],
      backend: "hatchling.build",
      backendPath: ["tools"],
    });
  });

  it("uses PEP 517's default backend where the manifest declares none", async () => {
    await writeFile(join(workspace, "uv.lock"), lock('{ editable = "." }'));
    await writeFile(join(workspace, "pyproject.toml"), '[project]\nname = "tinypkg"\n');
    expect(await uvEditableProject(workspace)).toMatchObject({
      requires: ["setuptools>=40.8.0"],
      backend: "setuptools.build_meta:__legacy__",
    });
  });

  it("has nothing to install for a virtual project", async () => {
    await writeFile(join(workspace, "uv.lock"), lock('{ virtual = "." }'));
    expect(await uvEditableProject(workspace)).toBeNull();
  });

  it("refuses a build system that names something other than a registry release or a module", async () => {
    await writeFile(join(workspace, "uv.lock"), lock('{ editable = "." }'));
    for (const system of [
      'requires = ["backend @ https://example.invalid/backend.whl"]\nbuild-backend = "b"',
      'requires = ["--index-url=https://example.invalid"]\nbuild-backend = "b"',
      'requires = ["hatchling"]\nbuild-backend = "os; import x"',
      'requires = ["hatchling"]\nbuild-backend = "b"\nbackend-path = ["../outside"]',
    ]) {
      await writeFile(join(workspace, "pyproject.toml"), `[build-system]\n${system}\n`);
      expect(await uvEditableProject(workspace)).toMatchObject({ kind: "refused" });
    }
  });

  it("reads the environment's interpreter version from pyvenv.cfg", async () => {
    expect(await uvEnvironmentPython(workspace)).toBeNull();
    await mkdir(join(workspace, ".venv"));
    await writeFile(
      join(workspace, ".venv", "pyvenv.cfg"),
      "home = /usr/local/bin\nversion_info = 3.12.12\n",
    );
    expect(await uvEnvironmentPython(workspace)).toBe("3.12");
  });
});

it("admits plain requirements and nothing that names a URL, a path or an option", () => {
  for (const plain of [
    "hatchling",
    "editables~=0.3",
    "setuptools>=61,<80",
    "a[b,c]==1.0",
    'wheel; python_version < "3.12"',
  ])
    expect(isPlainRequirement(plain), plain).toBe(true);
  for (const other of [
    "pkg @ file:///x",
    "-e .",
    "--extra-index-url=x",
    "./local",
    "pkg==1 --hash=x",
  ])
    expect(isPlainRequirement(other), other).toBe(false);
});

describe("the uv packages installing would build", () => {
  const hash = `sha256:${"a".repeat(64)}`;
  it("names each archive-only release and local tree, and leaves out what cannot be built safely", async () => {
    await writeFile(
      join(workspace, "uv.lock"),
      [
        "version = 1",
        '[[package]]\nname = "app"\nversion = "0.1.0"\nsource = { editable = "." }',
        `[[package]]\nname = "docopt"\nversion = "0.6.2"\nsource = { registry = "https://pypi.org/simple" }\nsdist = { url = "https://files.example/docopt-0.6.2.tar.gz", hash = "${hash}" }`,
        `[[package]]\nname = "wheeled"\nversion = "1.0.0"\nsource = { registry = "https://pypi.org/simple" }\nsdist = { url = "https://files.example/wheeled-1.0.0.tar.gz", hash = "${hash}" }\nwheels = [{ url = "https://files.example/wheeled-1.0.0-py3-none-any.whl", hash = "${hash}" }]`,
        '[[package]]\nname = "member"\nversion = "0.1.0"\nsource = { editable = "packages/member" }',
        '[[package]]\nname = "vendored"\nversion = "0.1.0"\nsource = { directory = "vendor/lib" }',
        '[[package]]\nname = "virtual-member"\nversion = "0.1.0"\nsource = { virtual = "packages/docs" }',
        '[[package]]\nname = "fromgit"\nversion = "1.0.0"\nsource = { git = "https://example.invalid/x?rev=a#a" }',
        '[[package]]\nname = "outside"\nversion = "1.0.0"\nsource = { directory = "../elsewhere" }',
        '[[package]]\nname = "unchecked"\nversion = "1.0.0"\nsource = { registry = "https://pypi.org/simple" }\nsdist = { url = "https://files.example/unchecked-1.0.0.tar.gz" }',
        "",
      ].join("\n\n"),
    );
    const plan = await uvSourceBuilds(workspace);
    expect(plan.builds).toEqual([
      {
        kind: "archive",
        name: "docopt",
        version: "0.6.2",
        url: "https://files.example/docopt-0.6.2.tar.gz",
        hash,
        file: "docopt-0.6.2.tar.gz",
      },
      { kind: "tree", name: "member", path: "packages/member", editable: true },
      { kind: "tree", name: "vendored", path: "vendor/lib", editable: false },
    ]);
    expect(plan.leftOut.map((entry) => entry.name)).toEqual(["fromgit", "outside", "unchecked"]);
    expect(plan.leftOut[0]?.reason).toContain("git source");
  });

  it("names nothing without a lockfile", async () => {
    expect(await uvSourceBuilds(workspace)).toEqual({ builds: [], leftOut: [] });
  });
});
