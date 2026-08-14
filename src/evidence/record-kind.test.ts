import { describe, expect, it } from "vitest";
import { recordKindOf } from "./record-kind.ts";

describe("record kind", () => {
  it("is the bare record type where the type already names one kind of subject", () => {
    expect(recordKindOf("session-stopped", { stopReason: "completed", steps: 4 })).toBe(
      "session-stopped",
    );
    expect(recordKindOf("escalation", { gateId: "tests" })).toBe("escalation");
  });

  it("names the gate, because every gate writes the same record type", () => {
    expect(recordKindOf("gate-run", { gateId: "lint", status: "passed" })).toBe("gate-run:lint");
    expect(recordKindOf("gate-run", { gateId: "tests", status: "passed" })).toBe("gate-run:tests");
  });

  it("names the tool, because every tool writes the same record type", () => {
    expect(recordKindOf("tool-call", { toolName: "shell", decision: "allowed" })).toBe(
      "tool-call:shell",
    );
    expect(recordKindOf("tool-call", { toolName: "write", decision: "allowed" })).toBe(
      "tool-call:write",
    );
  });

  it("falls back to the bare type when the discriminating field is absent or not a string", () => {
    expect(recordKindOf("gate-run", { status: "passed" })).toBe("gate-run");
    expect(recordKindOf("tool-call", { toolName: 3 })).toBe("tool-call");
    expect(recordKindOf("gate-run", undefined)).toBe("gate-run");
    expect(recordKindOf("gate-run", "not an object")).toBe("gate-run");
  });
});
