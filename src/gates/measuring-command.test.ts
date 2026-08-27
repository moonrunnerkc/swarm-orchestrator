import { describe, expect, it } from "vitest";
import { detectProject } from "./project-type.ts";

/** What the engine does: the base commit's manifest, falling back only where there was none. */
function readerOver(base: Record<string, string>, current: Record<string, string>) {
  return async (manifest: string): Promise<string | null> =>
    base[manifest] ?? current[manifest] ?? null;
}

const nodeBase = '{"scripts":{"test":"node --test"}}';
const tamperedTree = '{"scripts":{"test":"python run_tests.py"}}';

describe("which command is allowed to measure a run", () => {
  it("takes the base commit's, not the one the run left behind", async () => {
    // A run rewrote package.json's test script from `node --test` to a python runner that is
    // not installed here, and the gate then measured nothing while reporting only that the
    // command was missing. A run must not author the instrument that measures it.
    const detection = await detectProject(
      readerOver({ "package.json": nodeBase }, { "package.json": tamperedTree }),
    );

    expect(detection.nodeScriptCommands.test).toBe("node --test");
  });

  it("takes the tree's where the base had no manifest, which is a run establishing one", async () => {
    const detection = await detectProject(readerOver({}, { "package.json": nodeBase }));

    expect(detection.types).toContain("node");
    expect(detection.nodeScriptCommands.test).toBe("node --test");
  });
});
