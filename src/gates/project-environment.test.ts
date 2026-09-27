import { expect, it } from "vitest";
import { planGates } from "../config/init.ts";
import { detectEnvironment } from "./project-environment.ts";
import { detectProject } from "./project-type.ts";

const reader = (files: Record<string, string>) => async (path: string) => files[path] ?? null;
it("honors declared pnpm and refuses ambiguous undeclared lockfiles", async () => {
  expect(
    await detectEnvironment(
      reader({ "package.json": '{"packageManager":"pnpm@10.0.0"}', "pnpm-lock.yaml": "lock" }),
    ),
  ).toMatchObject({ nodeManager: "pnpm", nodeManagerVersion: "10.0.0" });
  expect(
    await detectEnvironment(
      reader({ "package.json": "{}", "package-lock.json": "{}", "pnpm-lock.yaml": "lock" }),
    ),
  ).toHaveProperty("setupProblem");
});
it("plans configured Python tools in the uv environment without installing anything", async () => {
  const project = await detectProject(
    reader({
      "pyproject.toml": "[tool.pytest.ini_options]\n[tool.ruff]\n",
      "uv.lock": "version = 1",
    }),
  );
  const planned = planGates(project);
  expect(planned.map((gate) => gate.command)).toEqual([
    "uv run --locked --no-sync python -m pytest -q",
    "uv run --locked --no-sync python -m ruff check --no-fix .",
  ]);
  expect(planned.some((gate) => gate.command.includes("mypy"))).toBe(false);
});
it("uses an existing venv and refuses an unprepared Python environment", async () => {
  const configured = { "pyproject.toml": "[tool.pytest.ini_options]\n" };
  expect(
    planGates(
      await detectProject(reader({ ...configured, ".venv/pyvenv.cfg": "home = /usr/bin" })),
    )[0]?.command,
  ).toBe(".venv/bin/python -m pytest -q");
  expect(() =>
    planGates({
      types: ["python"],
      manifests: ["pyproject.toml"],
      nodeScripts: [],
      nodeScriptCommands: {},
      pythonTools: ["pytest"],
    }),
  ).toThrow("prepare");
});
