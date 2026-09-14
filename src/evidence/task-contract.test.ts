import { describe, expect, it } from "vitest";
import { parseTaskContract } from "./task-contract.ts";

const contract = {
  version: 2,
  taskId: "path",
  objective: "path contract",
  dependsOn: [],
  allowedPaths: ["src/a.ts"],
  immutablePaths: [],
  allowedTools: ["read", "write"],
  network: "unrestricted",
  requiredChecks: ["tests"],
  budget: { maxSteps: 5, maxWallMs: 1000 },
  riskTier: "medium",
  scopeAuthority: "controller",
};

describe("contract path boundary", () => {
  it.each(["../outside", "/etc/config", "C:\\config", "~/config", "src/*", "src/\nfile", "."])(
    "rejects unsupported scope %j",
    (path) => {
      expect(() => parseTaskContract({ ...contract, allowedPaths: [path] })).toThrow(
        /unsupported workspace-relative path/,
      );
    },
  );
  it("normalizes equivalent paths before comparing immutable scope", () => {
    expect(
      parseTaskContract({ ...contract, allowedPaths: ["./src//x/../a.ts", "src\\a.ts"] })
        .allowedPaths,
    ).toEqual(["src/a.ts"]);
    expect(() =>
      parseTaskContract({ ...contract, allowedPaths: ["./src/a.ts"], immutablePaths: ["src/**"] }),
    ).toThrow(/both writable and immutable/);
  });
  it("keeps version-one contracts readable without inventing new restrictions", () => {
    expect(parseTaskContract({ ...contract, version: 1 })).toEqual({ ...contract, version: 1 });
  });
});
