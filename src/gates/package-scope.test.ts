import { expect, it } from "vitest";
import { assemblePackageGates, outsidePackages, packageSelection } from "./package-scope.ts";

it("qualifies mixed Node and Python checks with their selected directory", async () => {
  const files: Record<string, string> = {
    "packages/js/package.json": '{"scripts":{"test":"node --test"}}',
    "packages/py/pyproject.toml": "[tool.pytest.ini_options]\n",
    "packages/py/uv.lock": "version = 1",
  };
  const { gates } = await assemblePackageGates(async (path) => files[path] ?? null, {
    packages: ["packages/js", "packages/py"],
  });
  const tests = gates.filter((gate) => gate.id.startsWith("tests:"));
  expect(tests.map((gate) => gate.id)).toEqual(["tests:packages/js", "tests:packages/py"]);
  for (const gate of tests)
    expect(gate.source.kind === "command" && gate.source.command).toContain(
      `cd '${gate.id.slice(6)}'`,
    );
  expect(
    outsidePackages(["packages/js/a.js", "package-lock.json", "other/file.py"], ["packages/js"]),
  ).toEqual(["package-lock.json", "other/file.py"]);
});
it.each([["../escape"], ["a", "a/b"], ["a", "a"], ["a;echo"]])(
  "refuses invalid package selection %s",
  (...paths) => {
    expect(() => packageSelection(paths)).toThrow();
  },
);
