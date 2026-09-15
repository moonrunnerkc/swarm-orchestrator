import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The standalone verifier must carry no provider, worker or screen code and none of the agent's
 * run assembly. This walks every import reachable from its entry, type imports included, since
 * tsc emits every file in the program whether or not the import that reached it is erased, and
 * refuses a closure that touches any of the four.
 */
const sourceRoot = new URL(".", import.meta.url).pathname;
const entry = join(sourceRoot, "swarm-verify.ts");

const forbidden = /^(providers|workers|tui)\/|^agent-run\.ts$/;

/** Static, dynamic and type-only imports of relative modules, as written. */
const importSpecifier = /\b(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;

async function importClosure(start: string): Promise<ReadonlyMap<string, string | null>> {
  const reachedFrom = new Map<string, string | null>();
  const pending: { file: string; from: string | null }[] = [{ file: start, from: null }];
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined || reachedFrom.has(next.file)) {
      continue;
    }
    let source: string;
    try {
      source = await readFile(next.file, "utf8");
    } catch {
      continue;
    }
    reachedFrom.set(next.file, next.from);
    for (const match of source.matchAll(importSpecifier)) {
      pending.push({ file: resolve(dirname(next.file), match[1] ?? ""), from: next.file });
    }
  }
  return reachedFrom;
}

function crossings(closure: ReadonlyMap<string, string | null>, root: string): readonly string[] {
  const found: string[] = [];
  for (const [file, from] of closure) {
    const path = relative(root, file);
    if (forbidden.test(path)) {
      found.push(`${path} <- ${from === null ? "entry" : relative(root, from)}`);
    }
  }
  return found.sort();
}

describe("the standalone verifier's import boundary", () => {
  let scratch = "";

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), "swarm-verify-boundary-"));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it("catches a crossing two imports away, through a type-only import, so a clean scan means something", async () => {
    await mkdir(join(scratch, "providers"), { recursive: true });
    await writeFile(join(scratch, "entry.ts"), 'import { a } from "./middle.ts";\nexport { a };\n');
    await writeFile(
      join(scratch, "middle.ts"),
      'import type { Registry } from "./providers/registry.ts";\nexport const a: Registry | null = null;\n',
    );
    await writeFile(join(scratch, "providers", "registry.ts"), "export type Registry = 1;\n");

    const found = crossings(await importClosure(join(scratch, "entry.ts")), scratch);

    expect(found).toEqual(["providers/registry.ts <- middle.ts"]);
  });

  it("catches a dynamic import as well as a static one", async () => {
    await mkdir(join(scratch, "workers"), { recursive: true });
    await writeFile(
      join(scratch, "entry.ts"),
      'export const run = () => import("./workers/parallel-run.ts");\n',
    );
    await writeFile(join(scratch, "workers", "parallel-run.ts"), "export const x = 1;\n");

    const found = crossings(await importClosure(join(scratch, "entry.ts")), scratch);

    expect(found).toEqual(["workers/parallel-run.ts <- entry.ts"]);
  });

  it("is not crossed from src/swarm-verify.ts", async () => {
    const closure = await importClosure(entry);

    // Verify, ci and gates between them reach the evidence, gates and exec modules, so a
    // closure this small would mean the walk found nothing rather than that nothing crossed.
    expect(closure.size).toBeGreaterThan(60);
    expect(crossings(closure, sourceRoot)).toEqual([]);
  });
});
