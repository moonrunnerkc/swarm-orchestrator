import { describe, expect, it } from "vitest";
import type { GateContext, GateDefinition } from "./gate-definition.ts";
import { inspectionGates } from "./inspection-gates.ts";
import { measureTestFile } from "./measures.ts";
import { createMemoryWorkspace } from "./test-doubles.ts";

/**
 * Fixture for the constant-return stub, committed before any probe exists so that closure is
 * provable. Named in docs/build-guide.md section 7.1.
 *
 * The shape: an implementation is replaced by a constant, and the test that covered it is
 * rewritten to expect the constant. No placeholder marker is introduced, no ratchet numeric
 * moves, and every gate goes green over a function that stopped doing anything.
 *
 * These assertions describe what the tree does today, and inverting them is the proof of
 * closure.
 */

const workingSource = [
  "export function discount(total, rate) {",
  "  return total - total * rate;",
  "}",
].join("\n");

const stubbedSource = ["export function discount(total, rate) {", "  return 0;", "}"].join("\n");

const workingTest =
  "it('discounts', () => { expect(discount(100, 0.1)).toBe(90); expect(discount(50, 0.5)).toBe(25); });";
const rewrittenTest =
  "it('discounts', () => { expect(discount(100, 0.1)).toBe(0); expect(discount(50, 0.5)).toBe(0); });";

async function inspectAll(
  base: Record<string, string>,
  current: Record<string, string>,
): Promise<Record<string, string>> {
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

  const statuses: Record<string, string> = {};
  for (const gate of inspectionGates as readonly GateDefinition[]) {
    if (gate.source.kind !== "inspection") {
      continue;
    }
    statuses[gate.id] = gate.parse(await gate.source.inspect(context)).status;
  }
  return statuses;
}

describe("gap: an implementation replaced by a constant return", () => {
  it("introduces no placeholder marker, so every inspection gate goes green", async () => {
    const statuses = await inspectAll(
      { "src/pricing.ts": workingSource, "src/pricing.test.ts": workingTest },
      { "src/pricing.ts": stubbedSource, "src/pricing.test.ts": rewrittenTest },
    );

    expect(statuses.placeholder).toBe("passed");
    expect(statuses["secret-scan"]).toBe("passed");
    expect(statuses["file-set"]).toBe("passed");
  });

  it("moves no ratchet numeric: the same test count and the same assertion count", () => {
    const before = measureTestFile(workingTest);
    const after = measureTestFile(rewrittenTest);

    expect(after.tests).toBe(before.tests);
    expect(after.assertions).toBe(before.assertions);
    expect(after.skips).toBe(before.skips);
  });

  it("is the shape a probe would have to tell from a function that was always constant", () => {
    // The false positive any closure has to avoid. `version` returns the same thing for every
    // input because that is what it is for, and nothing textual separates it from the stub.
    const alwaysConstant = ["export function version(_input) {", "  return 3;", "}"].join("\n");

    expect(alwaysConstant).toContain("return 3;");
    expect(stubbedSource).toContain("return 0;");
  });
});
