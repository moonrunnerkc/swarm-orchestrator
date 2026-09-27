import { describe, expect, it } from "vitest";
import { pythonGates } from "./python-gates.ts";

const detection = {
  types: ["python" as const],
  manifests: ["pyproject.toml"],
  nodeScripts: [],
  nodeScriptCommands: {},
  pythonCommand: "uv run --locked --no-sync python -m",
  pythonTools: ["mypy", "pytest", "ruff"],
};

describe("configured python tools the environment does not hold", () => {
  it("assembles an unavailable check that names the missing tool, never a failing one", () => {
    const gates = pythonGates({ ...detection, pythonToolsInstalled: ["pytest", "ruff"] });
    const typecheck = gates.find((gate) => gate.id === "typecheck");
    expect(typecheck?.source.kind).toBe("inspection");
    expect(
      typecheck?.source.kind === "inspection" ? typecheck.source.unavailableReason : "",
    ).toContain("pyproject.toml configures mypy, but the project's environment does not hold it");
    expect(gates.find((gate) => gate.id === "lint")?.source.kind).toBe("command");
    expect(gates.find((gate) => gate.id === "tests")?.source.kind).toBe("command");
  });

  it("assembles every configured check as a command when nothing is known about the environment", () => {
    const gates = pythonGates(detection);
    expect(gates.find((gate) => gate.id === "typecheck")?.source.kind).toBe("command");
  });
});
