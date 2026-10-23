import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  asksForTests,
  calledNames,
  couldHoldRequestedTests,
  createEditReview,
  taskStatements,
} from "./agent-edit-notices.ts";
import { createEditTool } from "./tools/file-tools.ts";
import { createPolicyGuard } from "./tools/policy-guard.ts";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** The shape of p-limit's limitFunction at the held-out base, abbreviated. */
const pLimitSource = `export default function pLimit(concurrency) {
\tconst queue = [];
\treturn (fn) => new Promise((resolve) => queue.push(() => resolve((async () => fn())())));
}

export function limitFunction(function_, options) {
\tconst limit = pLimit(options);

\treturn (...arguments_) => limit(() => function_(...arguments_));
}
`;

const rewrite = `export function limitFunction(function_, options) {
${Array.from({ length: 20 }, (_, index) => `\tconst step${index} = ${index};`).join("\n")}
\tconst queue = [];
\treturn (...arguments_) => new Promise((resolve) => queue.push(() => resolve(function_(...arguments_))));
}`;

const task =
  "Give the returned function a clearQueue() method. What must not change: the limited function forwards all of its arguments and resolves with the function's result (or rejects with its error, a synchronous throw included). Add regression tests for this behaviour to the project's existing test suite.";

async function project() {
  const root = await mkdtemp(join(tmpdir(), "swarm-edit-review-"));
  roots.push(root);
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(join(root, "index.js"), pLimitSource);
  await writeFile(join(root, "other.js"), "import {limitFunction} from './index.js';\n");
  const guard = createPolicyGuard({
    workspaceRoot: root,
    homeDir: "/nonexistent",
    shellAllowlist: [],
    deniedRoots: [],
  });
  return { root, guard };
}

describe("the task's own statements", () => {
  it("keeps the sentences about behaviour to keep and tests to add", () => {
    expect(taskStatements(task)).toEqual([
      "What must not change: the limited function forwards all of its arguments and resolves with the function's result (or rejects with its error, a synchronous throw included).",
      "Add regression tests for this behaviour to the project's existing test suite.",
    ]);
    expect(asksForTests(task)).toBe(true);
    expect(asksForTests("Rename the files; behaviour must not change.")).toBe(false);
  });

  it("counts a root test.js and a type test as places requested tests go", () => {
    expect(
      ["test.js", "index.test-d.ts", "test/basic.ts", "src/a.spec.ts"].map(couldHoldRequestedTests),
    ).toEqual([true, true, true, true]);
    expect(couldHoldRequestedTests("index.js")).toBe(false);
  });

  it("reads calls, never a definition's own name", () => {
    expect([...calledNames("function pLimit(x) { return limit(() => fn(x)); }")]).toEqual([
      "limit",
      "fn",
    ]);
  });
});

describe("a rewrite that stops using an existing implementation", () => {
  it("is held until it gives a reason, with the task's words about what must not change", async () => {
    const { root, guard } = await project();
    const tool = createEditTool(
      guard,
      undefined,
      createEditReview({ workspace: root, taskStatements: taskStatements(task) }),
    );
    const edit = {
      path: "index.js",
      find: "export function limitFunction(function_, options) {\n\tconst limit = pLimit(options);\n\n\treturn (...arguments_) => limit(() => function_(...arguments_));\n}",
      replace: rewrite,
    };
    const refused = tool.execute(edit);
    await expect(refused).rejects.toThrow(/calls pLimit \(defined at index\.js:1\)/);
    await expect(tool.execute(edit)).rejects.toThrow(/a synchronous throw included/);
    const applied = await tool.execute({ ...edit, reason: "the queue needs its own clear" });
    expect(applied.text).toContain("replaced 1 occurrence(s) in index.js");
  });

  it("lets an extension that keeps delegating through without a word", async () => {
    const { root, guard } = await project();
    const tool = createEditTool(
      guard,
      undefined,
      createEditReview({ workspace: root, taskStatements: [] }),
    );
    const applied = await tool.execute({
      path: "index.js",
      find: "\treturn (...arguments_) => limit(() => function_(...arguments_));",
      replace: `\tconst limited = (...arguments_) => limit(() => function_(...arguments_));\n${Array.from({ length: 14 }, (_, i) => `\t// note ${i}`).join("\n")}\n\tlimited.clearQueue = () => limit.clearQueue();\n\treturn limited;`,
    });
    expect(applied.text).toBe("replaced 1 occurrence(s) in index.js");
  });

  it("names the files where a replaced text still occurs", async () => {
    const { root, guard } = await project();
    await writeFile(join(root, "third.js"), "import {limitFunction} from './index.js';\n");
    const tool = createEditTool(
      guard,
      undefined,
      createEditReview({ workspace: root, taskStatements: [] }),
    );
    const applied = await tool.execute({
      path: "other.js",
      find: "from './index.js'",
      replace: "from './limit.js'",
    });
    expect(applied.text).toContain(
      `[the replaced text "from './index.js'" still occurs in third.js]`,
    );
  });
});
