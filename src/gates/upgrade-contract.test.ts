import { expect, it } from "vitest";
import { taskPresetSchema } from "../evidence/task-preset.ts";
import { validateUpgradeManifest } from "./upgrade-contract.ts";

const node = taskPresetSchema.parse({
  kind: "upgrade",
  manager: "npm",
  manifest: "package.json",
  lockfile: "package-lock.json",
  dependencies: [{ name: "example", section: "dependencies", version: "2.0.0" }],
  sourcePaths: ["index.js"],
});
it("authorizes only named dependency fields and rejects script/metadata tampering", () => {
  if (node.kind !== "upgrade") throw new Error("fixture");
  const before = {
    name: "fixture",
    scripts: { test: "node --test" },
    dependencies: { example: "1.0.0" },
  };
  const after = { ...before, dependencies: { example: "2.0.0" } };
  expect(validateUpgradeManifest(JSON.stringify(before), JSON.stringify(after), node)).toBeNull();
  for (const altered of [
    { ...after, scripts: { test: "true" } },
    { ...after, name: "changed" },
  ])
    expect(
      validateUpgradeManifest(JSON.stringify(before), JSON.stringify(altered), node),
    ).toContain("unrelated manifest");
});
it("handles explicit uv dependency pins without granting unrelated TOML changes", () => {
  if (node.kind !== "upgrade") throw new Error("fixture");
  const uv = { ...node, manager: "uv" as const, manifest: "pyproject.toml", lockfile: "uv.lock" };
  const before = '[project]\nname="fixture"\ndependencies=["example==1.0.0"]\n';
  const after = before.replace("1.0.0", "2.0.0");
  expect(validateUpgradeManifest(before, after, uv)).toBeNull();
  expect(
    validateUpgradeManifest(before, after.replace('name="fixture"', 'name="other"'), uv),
  ).toContain("unrelated");
});
it("refuses pip-only reproducible upgrades and an implicit latest target", () => {
  expect(taskPresetSchema.safeParse({ ...node, manager: "pip" }).success).toBe(false);
  expect(
    taskPresetSchema.safeParse({
      ...node,
      dependencies: [{ name: "example", section: "dependencies", version: "latest" }],
    }).success,
  ).toBe(false);
});
