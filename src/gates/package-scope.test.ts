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

it.each([{}, { lint: 'node -e "process.exit(0)"' }])(
  "retains unavailable package checks when scripts are %j",
  async (scripts) => {
    const { gates } = await assemblePackageGates(
      async (path) => (path === "packages/demo/package.json" ? JSON.stringify({ scripts }) : null),
      { packages: ["packages/demo"] },
    );
    for (const id of ["tests", "typecheck", "format"]) {
      const gate = gates.find((entry) => entry.id === `${id}:packages/demo`);
      expect(gate, id).toBeDefined();
      expect(gate?.source.kind).toBe("inspection");
    }
    expect(new Set(gates.map((gate) => gate.id)).size).toBe(gates.length);
  },
);

it("retains repository-wide overrides exactly once alongside unavailable package checks", async () => {
  const { gates } = await assemblePackageGates(
    async (path) => (path === "unit/package.json" ? "{}" : null),
    {
      packages: ["unit"],
      commandOverrides: { "secret-scan": "node scan.mjs" },
    },
  );
  const scans = gates.filter((gate) => gate.id.startsWith("secret-scan"));
  expect(scans).toHaveLength(1);
  expect(scans[0]?.source).toMatchObject({ kind: "command", command: "node scan.mjs" });
  expect(gates.find((gate) => gate.id === "tests:unit")).toBeDefined();
});
