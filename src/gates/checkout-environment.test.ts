import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  lockfileIdentity,
  producedSince,
  removalRoots,
  removeProduced,
  snapshotIgnored,
} from "./checkout-environment.ts";

let checkout = "";

async function put(path: string, text: string) {
  await mkdir(join(checkout, path, ".."), { recursive: true });
  await writeFile(join(checkout, path), text);
}

beforeEach(async () => {
  checkout = await mkdtemp(join(tmpdir(), "swarm-environment-"));
  execFileSync("git", ["init", "-q"], { cwd: checkout });
  await put(".gitignore", "node_modules/\ndist/\n");
  await put("package.json", "{}\n");
  await put("package-lock.json", '{"lockfileVersion":3}\n');
  await put("node_modules/dep/index.js", "module.exports = 1;\n");
  await put("node_modules/dep/package.json", '{"name":"dep"}\n');
});

afterEach(async () => {
  await rm(checkout, { recursive: true, force: true });
});

it("removes what a run added to the ignored tree and keeps what the install prepared", async () => {
  const prepared = await snapshotIgnored(checkout);
  expect([...prepared.keys()]).toEqual([
    "node_modules/dep/index.js",
    "node_modules/dep/package.json",
  ]);
  // What depose's build left behind, and a cache a runner wrote inside the dependencies.
  await put("dist/index.d.ts", "export declare const x: number;\n");
  await put("dist/nested/more.js", "\n");
  await put("node_modules/.vite/results.json", "{}\n");
  const produced = producedSince(prepared, await snapshotIgnored(checkout));
  expect(produced.altered).toEqual([]);
  const roots = await removalRoots(checkout, produced.added, prepared);
  expect(roots).toEqual(["dist", "node_modules/.vite"]);
  await removeProduced(checkout, roots);
  expect(await readdir(checkout)).not.toContain("dist");
  expect((await readdir(join(checkout, "node_modules"))).sort()).toEqual(["dep"]);
  expect(producedSince(prepared, await snapshotIgnored(checkout))).toEqual({
    added: [],
    altered: [],
  });
});

it("names a prepared entry a run changed or removed, which no removal can put back", async () => {
  const prepared = await snapshotIgnored(checkout);
  await put("node_modules/dep/index.js", "module.exports = 2;\n");
  await rm(join(checkout, "node_modules/dep/package.json"));
  expect(producedSince(prepared, await snapshotIgnored(checkout)).altered).toEqual([
    "node_modules/dep/index.js",
    "node_modules/dep/package.json",
  ]);
});

it("sees a rewrite that keeps the size, by its modification time", async () => {
  const prepared = await snapshotIgnored(checkout);
  await put("node_modules/dep/index.js", "module.exports = 7;\n");
  await utimes(join(checkout, "node_modules/dep/index.js"), new Date(0), new Date(1_000_000));
  expect(producedSince(prepared, await snapshotIgnored(checkout)).altered).toEqual([
    "node_modules/dep/index.js",
  ]);
});

it("never removes a directory that holds a file the tree keeps", async () => {
  // A uv workspace member's offline build wrote ignored output beside the member's tracked
  // manifest; removing at the member's directory took the manifest with it.
  await put(".gitignore", "node_modules/\ndist/\n__pycache__/\n*.egg-info/\n");
  await put("member/pyproject.toml", "[project]\nname = 'member'\n");
  await put("member/src/member/__init__.py", "OFFSET = 1\n");
  execFileSync("git", ["add", "-A"], { cwd: checkout });
  const prepared = await snapshotIgnored(checkout);
  await put("member/src/member/__pycache__/__init__.cpython-312.pyc", "x");
  await put("member/src/member.egg-info/PKG-INFO", "x");
  const { added } = producedSince(prepared, await snapshotIgnored(checkout));
  const roots = await removalRoots(checkout, added, prepared);
  expect(roots).toEqual(["member/src/member.egg-info", "member/src/member/__pycache__"]);
  await removeProduced(checkout, roots);
  expect((await readdir(join(checkout, "member"))).sort()).toEqual(["pyproject.toml", "src"]);
  expect((await readdir(join(checkout, "member/src/member"))).sort()).toEqual(["__init__.py"]);
});

it("refuses to remove a path that leaves the checkout", async () => {
  await expect(removeProduced(checkout, ["../outside"])).rejects.toThrow(/not a path inside/);
  await expect(removeProduced(checkout, ["/etc"])).rejects.toThrow(/not a path inside/);
});

it("identifies the lockfiles an install reads, tracked or added, by content", async () => {
  execFileSync("git", ["add", "-A"], { cwd: checkout });
  const before = await lockfileIdentity(checkout);
  expect(await lockfileIdentity(checkout)).toBe(before);
  // A manifest change alone is not a different install.
  await put("package.json", '{"name":"renamed"}\n');
  expect(await lockfileIdentity(checkout)).toBe(before);
  await put("package-lock.json", '{"lockfileVersion":3,"packages":{}}\n');
  expect(await lockfileIdentity(checkout)).not.toBe(before);
  await put("package-lock.json", '{"lockfileVersion":3}\n');
  await put("packages/a/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  expect(await lockfileIdentity(checkout)).not.toBe(before);
});
