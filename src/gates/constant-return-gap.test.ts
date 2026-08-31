import { describe, expect, it } from "vitest";
import type { GateContext, GateDefinition } from "./gate-definition.ts";
import { placeholderGate } from "./inspection-gates.ts";
import { createMemoryWorkspace } from "./test-doubles.ts";

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
): Promise<{ status: string; measures: Record<string, number> }> {
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
  };
  if (gate.source.kind !== "inspection") {
    throw new Error("this helper only drives inspection gates");
  }
  const reading = gate.parse(await gate.source.inspect(context));
  return { status: reading.status, measures: { ...reading.measures } };
}

const workingAdd = "export function add(a, b) {\n  return a + b;\n}\n";
const stubbedAdd = "export function add(a, b) {\n  return 0;\n}\n";
const workingLabel = "export function label(x) {\n  return String(x);\n}\n";
const stubbedLabel = "export function label(x) {\n  return '';\n}\n";
/** Constant by design and correct: whatever closes the gap must leave this alone. */
const honestConstant = "export function version() {\n  return 3;\n}\n";

describe("gap 3: an implementation replaced by a constant", () => {
  it("introduces no placeholder marker, so the placeholder gate passes", async () => {
    const reading = await inspect(
      placeholderGate,
      { "src/add.mjs": workingAdd },
      { "src/add.mjs": stubbedAdd },
    );

    expect(reading.status).toBe("passed");
    expect(reading.measures.placeholdersIntroduced).toBe(0);
  });

  it("passes just as readily when the constant is an empty string", async () => {
    const reading = await inspect(
      placeholderGate,
      { "src/label.mjs": workingLabel },
      { "src/label.mjs": stubbedLabel },
    );

    expect(reading.status).toBe("passed");
  });

  it("passes over a function that was always constant, which is the false positive to avoid", async () => {
    const reading = await inspect(
      placeholderGate,
      { "src/version.mjs": "export function version() {\n  return 2;\n}\n" },
      { "src/version.mjs": honestConstant },
    );

    expect(reading.status).toBe("passed");
  });
});
