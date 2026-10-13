import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lockfileChoices } from "../cli-verify-options.ts";
import { instrumentChanges as offlineChanges } from "../evidence/verifier/status.mjs";
import { lockfileNames } from "./dependency-install.ts";
import { type InstalledRunner, observeInstalled } from "./instrument-dependencies.ts";
import {
  type InstrumentObservation,
  type InstrumentTrees,
  instrumentChanges,
  instrumentRule,
} from "./instrument-identity.ts";

let root = "";
afterEach(async () => {
  if (root !== "") await rm(root, { recursive: true, force: true });
});

const npmEntry = {
  version: "11.0.0",
  resolved: "https://registry.npmjs.org/npm/-/npm-11.0.0.tgz",
  integrity: "sha512-npm",
};
const lockWith = (packages: Record<string, unknown>) =>
  JSON.stringify({ name: "w", lockfileVersion: 3, packages: { "": { name: "w" }, ...packages } });

function trees(reference: string | null, current: string | null, installedRoot: string) {
  const files = (lock: string | null) => (lock === null ? {} : { "package-lock.json": lock });
  const before = files(reference);
  const after = files(current);
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  const tree: InstrumentTrees = {
    reference: async (path) => before[path as keyof typeof before] ?? null,
    current: async (path) => after[path as keyof typeof after] ?? null,
    changed: [...paths].filter(
      (path) => before[path as "package-lock.json"] !== after[path as "package-lock.json"],
    ),
    listed: paths,
    installedRoot,
  };
  return tree;
}

/** An installed `npm` package with the executable link the package manager makes for it. */
async function installNpm(version = "11.0.0") {
  root = await mkdtemp(join(tmpdir(), "swarm-installed-"));
  await mkdir(join(root, "node_modules", "npm", "bin"), { recursive: true });
  await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
  await writeFile(
    join(root, "node_modules", "npm", "package.json"),
    JSON.stringify({ name: "npm", version }),
  );
  await writeFile(join(root, "node_modules", "npm", "bin", "npm-cli.js"), "#!/usr/bin/env node\n");
  await symlink("../npm/bin/npm-cli.js", join(root, "node_modules", ".bin", "npm"));
}

/** Both implementations read the record the same way: the live one and the bundled verifier's. */
function changes(installed: readonly InstalledRunner[]) {
  const observation: InstrumentObservation = {
    rule: instrumentRule,
    tools: [],
    files: [],
    dependencies: [],
    installed,
    complete: true,
    residuals: [],
  };
  const live = instrumentChanges(observation);
  expect(offlineChanges(JSON.parse(JSON.stringify(observation)))).toEqual(live);
  return live;
}

describe("an interpreter name linked under node_modules/.bin", () => {
  it("is the reference's own instrument where both lockfiles pin the package that owns it", async () => {
    await installNpm();
    const lock = lockWith({ "node_modules/npm": npmEntry });
    const installed = await observeInstalled(trees(lock, lock, root), []);
    expect(installed).toEqual([
      { name: "node_modules/.bin/npm", expected: "11.0.0", found: "11.0.0", linked: true },
    ]);
    expect(changes(installed)).toEqual([]);
  });

  it("is a change where the reference lockfile does not pin that package", async () => {
    await installNpm();
    const installed = await observeInstalled(
      trees(lockWith({}), lockWith({ "node_modules/npm": npmEntry }), root),
      [],
    );
    expect(installed).toEqual([
      { name: "node_modules/.bin/npm", expected: null, found: "present", linked: false },
    ]);
    expect(changes(installed)).toEqual(["installed node_modules/.bin/npm executable link"]);
  });

  it("is a change where the two lockfiles pin the package differently", async () => {
    await installNpm();
    const installed = await observeInstalled(
      trees(
        lockWith({ "node_modules/npm": { ...npmEntry, integrity: "sha512-other" } }),
        lockWith({ "node_modules/npm": npmEntry }),
        root,
      ),
      [],
    );
    expect(installed[0]?.linked).toBe(false);
  });

  it("is a change where what is installed is not the version pinned", async () => {
    await installNpm("11.1.0");
    const lock = lockWith({ "node_modules/npm": npmEntry });
    const installed = await observeInstalled(trees(lock, lock, root), []);
    expect(installed).toEqual([
      { name: "node_modules/.bin/npm", expected: "11.0.0", found: "11.1.0", linked: true },
    ]);
    expect(changes(installed)).toEqual([
      "installed node_modules/.bin/npm 11.1.0 (lockfile 11.0.0)",
    ]);
  });

  it("is a change where a shim no package owns shadows node", async () => {
    await installNpm();
    await writeFile(join(root, "node_modules", ".bin", "node"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    const lock = lockWith({ "node_modules/npm": npmEntry });
    const installed = await observeInstalled(trees(lock, lock, root), []);
    expect(installed.find((runner) => runner.name === "node_modules/.bin/node")).toEqual({
      name: "node_modules/.bin/node",
      expected: null,
      found: "present",
      linked: false,
    });
    expect(changes(installed)).toEqual(["installed node_modules/.bin/node executable link"]);
  });
});

it("keeps the parser's lockfile choices the installer's own list", () => {
  expect(lockfileChoices).toEqual(lockfileNames);
});
