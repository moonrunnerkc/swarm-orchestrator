import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 6 is a wing, not a foundation. The single-agent path must be able to run with this
 * directory deleted, which is only true while nothing under it is imported by the loop, the
 * tools, the gates, or the one function that assembles a run.
 */
const mustNotReachWorkers = ["core", "tools", "gates"] as const;
const sourceRoot = new URL("..", import.meta.url).pathname;

function importsWorkers(source: string): boolean {
  return /\bfrom\s+"[^"]*\bworkers\//.test(source);
}

async function productionSources(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await productionSources(path)));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      found.push(path);
    }
  }
  return found;
}

describe("the phase-6 import boundary", () => {
  it("recognises an import of this directory, so a clean scan means something", () => {
    expect(importsWorkers('import { runInParallel } from "./workers/parallel-run.ts";')).toBe(true);
    expect(importsWorkers('import { x } from "../workers/trail.ts";')).toBe(true);
    expect(importsWorkers('import { runAgentLoop } from "./core/loop.ts";')).toBe(false);
    expect(importsWorkers("// workers/trail.ts explains why")).toBe(false);
  });

  it("is not crossed by the loop, the tools, the gates, or the run assembly", async () => {
    const files = [
      join(sourceRoot, "agent-run.ts"),
      ...(
        await Promise.all(
          mustNotReachWorkers.map((name) => productionSources(join(sourceRoot, name))),
        )
      ).flat(),
    ];
    const crossings: string[] = [];

    for (const file of files) {
      if (importsWorkers(await readFile(file, "utf8"))) {
        crossings.push(file.slice(sourceRoot.length));
      }
    }

    expect(files.length).toBeGreaterThan(20);
    expect(crossings).toEqual([]);
  });
});
