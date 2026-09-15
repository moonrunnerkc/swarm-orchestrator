import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { z } from "zod";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { readTaskGraph } from "../workers/task-graph.ts";

const execute = promisify(execFile);
it("freezes six usable development bases whose complete behavior checks refuse no work", async () => {
  const imported = await execute(process.execPath, [
    "--input-type=module",
    "-e",
    `import {developmentGoals} from ${JSON.stringify(new URL("../../scripts/redesign/development-goals.mjs", import.meta.url).href)}; console.log(JSON.stringify(developmentGoals));`,
  ]);
  const cases = z
    .array(
      z.object({
        id: z.string(),
        category: z.string(),
        goal: z.string(),
        files: z.record(z.string(), z.string()),
        nodes: z.array(z.unknown()).optional(),
        check: z.string(),
      }),
    )
    .parse(JSON.parse(imported.stdout));
  expect(new Set(cases.map((goal) => goal.category)).size).toBe(6);
  const root = await mkdtemp(join(tmpdir(), "swarm-development-control-"));
  try {
    for (const goal of cases) {
      if (goal.nodes)
        expect(readTaskGraph({ goal: goal.goal, nodes: goal.nodes }).nodes.length).toBeGreaterThan(
          1,
        );
      const workspace = join(root, goal.id);
      await mkdir(join(workspace, ".acceptance"), { recursive: true });
      for (const [path, content] of Object.entries({
        ...goal.files,
        "package.json": JSON.stringify({ type: "module" }),
        ".acceptance/check.mjs": goal.check,
      }))
        await writeFile(join(workspace, path), content);
      const options = { cwd: workspace, env: harnessChildEnvironment().variables, timeout: 30000 };
      const baseline = await execute(process.execPath, ["--test", "--test-reporter=tap"], options);
      expect(baseline.stdout, goal.id).toContain("# fail 0");
      await expect(
        execute(process.execPath, [".acceptance/check.mjs"], options),
        goal.id,
      ).rejects.toMatchObject({ code: 1 });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
