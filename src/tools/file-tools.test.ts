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
