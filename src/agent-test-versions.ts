import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ToolCallOutcome } from "./core/model-client.ts";
import type { ToolInvocation, ToolInvoker } from "./core/tool-invoker.ts";
import { isTestFile } from "./gates/measures.ts";
import type { TestRetention } from "./gates/retained-tests.ts";

const run = promisify(execFile);

/**
 * Hands every version of a test file a worker's step leaves to the retention (test-retention-v1),
 * so a test the worker writes, sees fail and deletes before any gate cycle is still there to run
 * again. A file tool names its path; a shell command can change any file, so after one the test
 * files git reports changed are read. Nothing here decides anything: it keeps what was written.
 */
export function withTestVersions(
  inner: ToolInvoker,
  options: {
    readonly workspace: string;
    readonly retention: TestRetention;
    /** Tools that write through a path argument. */
    readonly writers: ReadonlySet<string>;
    /** Tools that run a command, after which any file may have changed. */
    readonly shells: ReadonlySet<string>;
  },
): ToolInvoker {
  let step = 0;
  const observe = async (path: string) =>
    options.retention.observe(
      path,
      await readFile(join(options.workspace, path), "utf8").catch(() => null),
      step,
    );
  return {
    async invoke(invocation: ToolInvocation): Promise<ToolCallOutcome> {
      const outcome = await inner.invoke(invocation);
      step += 1;
      const path = (invocation.input as { path?: unknown } | null)?.path;
      if (options.writers.has(invocation.toolName) && typeof path === "string" && isTestFile(path))
        await observe(path);
      else if (options.shells.has(invocation.toolName))
        for (const changed of await changedTestFiles(options.workspace)) await observe(changed);
      return outcome;
    },
  };
}

/** The test files git sees changed or added in the workspace; none where git cannot say. */
async function changedTestFiles(workspace: string): Promise<readonly string[]> {
  try {
    const { stdout } = await run("git", ["status", "--porcelain=v1", "-z", "-uall"], {
      cwd: workspace,
      maxBuffer: 16 * 1024 * 1024,
    });
    const entries = stdout.split("\0");
    const paths: string[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index] as string;
      if (entry.length < 4) continue;
      paths.push(entry.slice(3));
      // A rename or copy is followed by its source path, which is no entry of its own.
      if (entry[0] === "R" || entry[0] === "C") index += 1;
    }
    return paths.filter((path) => isTestFile(path));
  } catch {
    return [];
  }
}
