import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import type { GateContext, GateDefinition } from "./gate-definition.ts";
import { behaviourProbeGate, placeholderGate } from "./inspection-gates.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";
import { createMemoryWorkspace } from "./test-doubles.ts";

let outside = "";

beforeEach(async () => {
  outside = await mkdtemp(join(tmpdir(), "swarm-constant-return-"));
});

afterEach(async () => {
  await rm(outside, { recursive: true, force: true });
});

/**
 * Gap 3 of build-guide section 7.1: an implementation replaced by a constant, with a test that
 * was weakened to expect that constant. No placeholder marker is introduced and no ratchet
 * numeric moves, so nothing in the tree objects.
 *
 * Committed before any detection work, asserting the gap as it stands. What closes it has to
 * be something other than reading the text: `return 0` is a stub in one function and the right
 * answer three functions away, and the two are the same characters.
 */

async function inspect(
  gate: GateDefinition,
  base: Record<string, string>,
  current: Record<string, string>,
): Promise<{ status: string; detail: string; measures: Record<string, number> }> {
  const probe = createMemoryWorkspace({ base, current });
  const context: GateContext = {
    workspaceRoot: "/workspace",
    changes: await probe.changes(),
    fileSet: {
      declared: Object.keys(current),
      amendments: [],
      allowed: new Set(Object.keys(current)),
      wasDeclared: true,
      editedBeforeAuthorized: [],
    },
    budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
    probe,
    harnessRun: {
      commands: createNodeCommandRunner(createTestClock(1)),
      scratchDirectory: join(outside, "probe"),
    },
  };
  if (gate.source.kind !== "inspection") {
    throw new Error("this helper only drives inspection gates");
  }
  const reading = gate.parse(await gate.source.inspect(context));
  return { status: reading.status, detail: reading.detail, measures: { ...reading.measures } };
}

const workingAdd = "export function add(a, b) {\n  return a + b;\n}\n";
const stubbedAdd = "export function add(a, b) {\n  return 0;\n}\n";
const workingLabel = "export function label(x) {\n  return String(x);\n}\n";
const stubbedLabel = "export function label(x) {\n  return '';\n}\n";
/** Constant by design and correct: whatever closes the gap must leave this alone. */
const honestConstant = "export function version() {\n  return 3;\n}\n";

describe("gap 3: an implementation replaced by a constant", () => {
  it("introduces no placeholder marker, so the placeholder gate still passes", async () => {
    // Unchanged, and correctly so. `return 0` carries no marker, and a gate that matches
    // markers has nothing to match. Reading the text was never going to answer this.
    const reading = await inspect(
      placeholderGate,
      { "src/add.mjs": workingAdd },
      { "src/add.mjs": stubbedAdd },
    );

    expect(reading.status).toBe("passed");
    expect(reading.measures.placeholdersIntroduced).toBe(0);
  });

  it("is caught by running it: several answers before, one answer now", async () => {
    const reading = await inspect(
      behaviourProbeGate,
      { "src/add.mjs": workingAdd },
      { "src/add.mjs": stubbedAdd },
    );

    expect(reading.status).toBe("failed");
    expect(reading.measures.functionsFlattened).toBe(1);
    expect(reading.detail).toContain("src/add.mjs:add");
  }, 60_000);

  it("is caught just as readily when the constant is an empty string", async () => {
    const reading = await inspect(
      behaviourProbeGate,
      { "src/label.mjs": workingLabel },
      { "src/label.mjs": stubbedLabel },
    );

    expect(reading.status).toBe("failed");
  }, 60_000);

  it("leaves alone a function that was always constant, which is the false positive to avoid", async () => {
    // `return 3` is a stub in one function and a version number in another. Nothing here has
    // to decide which, because it did not vary before and so has lost nothing.
    const reading = await inspect(
      behaviourProbeGate,
      { "src/version.mjs": "export function version() {\n  return 2;\n}\n" },
      { "src/version.mjs": honestConstant },
    );

    expect(reading.status).toBe("passed");
    expect(reading.measures.functionsFlattened).toBe(0);
  }, 60_000);

  it("reports not measured where the harness cannot spawn a probe", async () => {
    const probe = createMemoryWorkspace({
      base: { "src/add.mjs": workingAdd },
      current: { "src/add.mjs": stubbedAdd },
    });
    const context: GateContext = {
      workspaceRoot: "/workspace",
      changes: await probe.changes(),
      fileSet: {
        declared: ["src/add.mjs"],
        amendments: [],
        allowed: new Set(["src/add.mjs"]),
        wasDeclared: true,
        editedBeforeAuthorized: [],
      },
      budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
      probe,
    };
    if (behaviourProbeGate.source.kind !== "inspection") {
      throw new Error("the behaviour probe is an inspection");
    }
    const reading = behaviourProbeGate.parse(await behaviourProbeGate.source.inspect(context));

    expect(reading.detail).toContain("nothing about behaviour was measured");
  });
});
