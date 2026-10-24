import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkoutTrees } from "./independent-checks.ts";
import { instrumentChanges, observeInstrument } from "./instrument-identity.ts";

let root: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: root });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-checkout-trees-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { lint: "eslint . && prettier -c src test" } }),
  );
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "index.ts"), "export const one = 1;\n");
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "base");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the base commit and the checkout as an instrument's two trees", () => {
  // ufo's lint names `src` to prettier. The base side read the directory's tree listing and the
  // checkout side read nothing, so an unchanged checkout's lint read as run under a changed
  // instrument, and putting `src` back stopped the run before its first model call.
  it("reads a directory a command names as no file on either side", async () => {
    const trees = await (await checkoutTrees(root, "HEAD"))();
    expect(await trees.reference("src")).toBeNull();
    expect(await trees.reference("src/index.ts")).toBe("export const one = 1;\n");
    const observed = await observeInstrument({ command: "npm run lint", argv: null }, trees);
    expect(instrumentChanges(observed)).toEqual([]);
  });
});
