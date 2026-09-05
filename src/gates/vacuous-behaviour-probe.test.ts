import { describe, expect, it } from "vitest";
import type { GateContext } from "./gate-definition.ts";
import { behaviourProbeGate } from "./inspection-gates.ts";

/**
 * A probe that probed nothing measured nothing. It used to report a pass, and once a passing
 * dynamic gate is what says the change was executed, that pass is the whole of the evidence
 * that anything ran. A change with no probeable function then reads as executed on the
 * strength of a gate that opened no file.
 */
async function readProbe(context: GateContext) {
  if (behaviourProbeGate.source.kind !== "inspection") {
    throw new Error("the behaviour probe is an inspection");
  }
  return behaviourProbeGate.parse(await behaviourProbeGate.source.inspect(context));
}

const noHarness = {
  workspaceRoot: "/repo",
  changes: { files: [{ path: "a.mjs", addedLines: 3 }] },
  fileSet: {
    wasDeclared: false,
    declared: [],
    amendments: [],
    allowed: new Set(),
    editedBeforeAuthorized: [],
  },
  budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
  probe: {} as never,
} as unknown as GateContext;

describe("a behaviour probe that probed nothing", () => {
  it("is not applicable where the harness cannot spawn a probe at all", async () => {
    const reading = await readProbe(noHarness);

    expect(reading.status).toBe("not-applicable");
  });
});
