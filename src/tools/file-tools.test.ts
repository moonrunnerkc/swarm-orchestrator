import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEditTool } from "./file-tools.ts";
import { createPolicyGuard } from "./policy-guard.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("literal edits", () => {
  it.each(["price $&", "$$", "$`", "$'", "雪🙂"])(
    "writes %s without replacement expansion",
    async (replacement) => {
      const root = await mkdtemp(join(tmpdir(), "swarm-literal-edit-"));
      roots.push(root);
      const guard = createPolicyGuard({
        workspaceRoot: root,
        homeDir: "/nonexistent",
        shellAllowlist: [],
        deniedRoots: [],
      });
      const tool = createEditTool(guard);
      const path = join(root, "text.txt");
      await writeFile(path, "left BEFORE right");
      await tool.execute({ path: "text.txt", find: "BEFORE", replace: replacement });
      expect(await readFile(path, "utf8")).toBe(`left ${replacement} right`);
      await writeFile(path, "BEFORE BEFORE");
      await tool.execute({
        path: "text.txt",
        find: "BEFORE",
        replace: replacement,
        replaceAll: true,
      });
      expect(await readFile(path, "utf8")).toBe(`${replacement} ${replacement}`);
    },
  );
});

it("reads a line range under byte and scan ceilings without splitting UTF-8 characters", async () => {
  const { createReadTool } = await import("./file-tools.ts");
  const root = await mkdtemp(join(tmpdir(), "swarm-ranged-read-"));
  roots.push(root);
  const guard = createPolicyGuard({
    workspaceRoot: root,
    homeDir: "/nonexistent",
    shellAllowlist: [],
    deniedRoots: [],
  });
  const tool = createReadTool(guard);
  await writeFile(join(root, "lines.txt"), "one\n雪🙂\nthree\n");
  expect((await tool.execute({ path: "lines.txt", startLine: 2, endLine: 2 })).text).toBe("雪🙂\n");
  const limited = await tool.execute({ path: "lines.txt", startLine: 2, maxBytes: 5 });
  expect(limited.text).toContain("雪");
  expect(limited.text).not.toContain("�");
  expect(limited.facts?.truncated).toBe(true);
});

describe("a batch of edits", () => {
  async function workspace() {
    const root = await mkdtemp(join(tmpdir(), "swarm-batch-edit-"));
    roots.push(root);
    const guard = createPolicyGuard({
      workspaceRoot: root,
      homeDir: "/nonexistent",
      shellAllowlist: [],
      deniedRoots: [],
    });
    await writeFile(join(root, "a.js"), "require('./oldName')\n");
    await writeFile(join(root, "b.js"), "require('./oldName')\nrequire('./other')\n");
    return { root, guard };
  }

  it("applies every replacement across files in one call, in order", async () => {
    const { root, guard } = await workspace();
    const result = await createEditTool(guard).execute({
      edits: [
        { path: "a.js", find: "./oldName", replace: "./new-name" },
        { path: "b.js", find: "./oldName", replace: "./new-name" },
        { path: "b.js", find: "./new-name')\n", replace: "./new-name.js')\n" },
      ],
    });
    expect(await readFile(join(root, "a.js"), "utf8")).toBe("require('./new-name')\n");
    expect(await readFile(join(root, "b.js"), "utf8")).toBe(
      "require('./new-name.js')\nrequire('./other')\n",
    );
    expect(result.facts).toEqual({ paths: ["a.js", "b.js"], edits: 3 });
  });

  it("writes nothing when one replacement cannot be made, and says which", async () => {
    const { root, guard } = await workspace();
    await expect(
      createEditTool(guard).execute({
        edits: [
          { path: "a.js", find: "./oldName", replace: "./new-name" },
          { path: "b.js", find: "./missing", replace: "x" },
        ],
      }),
    ).rejects.toThrow(/edit 2 \(b\.js\).*Nothing in the batch was applied/);
    expect(await readFile(join(root, "a.js"), "utf8")).toBe("require('./oldName')\n");
  });

  it("refuses every path the file set refuses before reading any of them", async () => {
    const { guard } = await workspace();
    const tool = createEditTool(guard, (path) => (path === "b.js" ? "b.js is not declared" : null));
    await expect(
      tool.execute({
        edits: [
          { path: "a.js", find: "a", replace: "b" },
          { path: "b.js", find: "r", replace: "s" },
        ],
      }),
    ).rejects.toThrow("b.js is not declared");
    expect(tool.pathsFrom({ edits: [{ path: "a.js", find: "a", replace: "b" }] })).toEqual([
      "a.js",
    ]);
  });

  it("asks a review before writing, and adds what it notes afterwards", async () => {
    const { root, guard } = await workspace();
    const seen: string[] = [];
    const tool = createEditTool(guard, undefined, {
      refuse: async (changes, reason) => {
        seen.push(`${changes.map((one) => one.path).join(",")}:${reason ?? "-"}`);
        return reason === undefined ? "give a reason" : null;
      },
      afterwards: async () => ["[noted]"],
    });
    await expect(tool.execute({ path: "a.js", find: "oldName", replace: "x" })).rejects.toThrow(
      "give a reason",
    );
    expect(await readFile(join(root, "a.js"), "utf8")).toBe("require('./oldName')\n");
    const applied = await tool.execute({
      path: "a.js",
      find: "oldName",
      replace: "x",
      reason: "because",
    });
    expect(applied.text).toBe("replaced 1 occurrence(s) in a.js\n[noted]");
    expect(seen).toEqual(["a.js:-", "a.js:because"]);
  });
});
