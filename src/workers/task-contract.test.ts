import { describe, expect, it } from "vitest";
import {
  contractsFromGraph,
  idempotencyKeyFor,
  MalformedTaskContractError,
  parseTaskContract,
} from "./task-contract.ts";

const wellFormed = {
  version: 1,
  taskId: "parser",
  objective: "make the parser handle an empty input",
  dependsOn: [],
  allowedPaths: ["src/parser.ts"],
  immutablePaths: [".github/**"],
  allowedTools: ["read", "write", "edit", "shell"],
  network: "denied",
  requiredChecks: ["tests"],
  budget: { maxSteps: 20, maxWallMs: 600_000 },
  riskTier: "low",
  scopeAuthority: "controller",
} as const;

describe("what one node of a decomposition was allowed to do", () => {
  it("reads a well-formed contract", () => {
    expect(parseTaskContract(wellFormed).taskId).toBe("parser");
  });

  it("refuses a contract that names no path it may write", () => {
    // A node that declares no files is a node whose scope nothing can check, which is the
    // whole of what a contract is for.
    expect(() => parseTaskContract({ ...wellFormed, allowedPaths: [] })).toThrow(
      MalformedTaskContractError,
    );
  });

  it("refuses a path that is both writable and immutable, since one of them is a lie", () => {
    expect(() =>
      parseTaskContract({
        ...wellFormed,
        allowedPaths: ["src/parser.ts"],
        immutablePaths: ["src/parser.ts"],
      }),
    ).toThrow(/both writable and immutable/i);
  });

  it("refuses a risk tier the build does not act on", () => {
    expect(() => parseTaskContract({ ...wellFormed, riskTier: "spicy" })).toThrow(/spicy/);
  });

  it("keys idempotency on what the work is, not on when it ran", () => {
    const first = idempotencyKeyFor(parseTaskContract(wellFormed), "abc123");
    const second = idempotencyKeyFor(parseTaskContract(wellFormed), "abc123");
    const different = idempotencyKeyFor(parseTaskContract(wellFormed), "def456");

    expect(first).toBe(second);
    expect(first).not.toBe(different);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("derives one contract per graph node, carrying the files that node declared", () => {
    const contracts = contractsFromGraph(
      {
        nodes: [
          { id: "a", instruction: "do a", dependsOn: [], files: ["src/a.ts"] },
          { id: "b", instruction: "do b", dependsOn: ["a"], files: ["src/b.ts"] },
        ],
      },
      { maxSteps: 20, maxWallMs: 600_000, immutablePaths: [".github/**"] },
    );

    expect(contracts.map((one) => one.taskId)).toEqual(["a", "b"]);
    expect(contracts[1]?.dependsOn).toEqual(["a"]);
    expect(contracts[0]?.allowedPaths).toEqual(["src/a.ts"]);
    expect(contracts[0]?.immutablePaths).toEqual([".github/**"]);
  });
});
