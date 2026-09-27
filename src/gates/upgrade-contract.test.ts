import { expect, it } from "vitest";
import { asJsonValue, digestOfBytes, digestOfJson } from "../evidence/canonical-json.ts";
import { taskPresetSchema } from "../evidence/task-preset.ts";
import { upgradeControlPasses } from "../evidence/verifier/upgrade.mjs";
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
  ).toMatch(/unrelated|outside the authorized/);
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

it("rejects mismatched managers, lock roots and duplicate dependency authorizations", () => {
  for (const changes of [
    { manager: "uv" },
    { manager: "pnpm" },
    { lockfile: "nested/package-lock.json" },
    {
      dependencies: [
        node.kind === "upgrade" && node.dependencies[0],
        node.kind === "upgrade" && node.dependencies[0],
      ],
    },
  ])
    expect(taskPresetSchema.safeParse({ ...node, ...changes }).success).toBe(false);
});

it.each(["npm", "pnpm", "uv"] as const)(
  "independently rejects missing or forged %s upgrade authorization",
  (manager) => {
    const preset = {
      kind: "upgrade",
      manager,
      manifest: manager === "uv" ? "pyproject.toml" : "package.json",
      lockfile:
        manager === "uv" ? "uv.lock" : manager === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json",
      dependencies: [{ name: "example", section: "dependencies", version: "2.0.0" }],
      sourcePaths: [],
    };
    const base =
      manager === "uv"
        ? '[project]\nname="fixture"\ndependencies=["example==1.0.0"]\n'
        : JSON.stringify({ scripts: { test: "node --test" }, dependencies: { example: "1.0.0" } });
    const candidate = base.replace("1.0.0", "2.0.0");
    const authorization = {
      rule: "upgrade-authorization-v1",
      presetDigest: digestOfJson(asJsonValue(preset)),
      base,
      candidate,
      manifest: preset.manifest,
      lockfile: preset.lockfile,
      touched: [preset.manifest, preset.lockfile],
      manifestDigest: digestOfBytes(candidate),
      lockDigest: "sha256:lock",
    };
    const resolution = {
      rule: "upgrade-resolution-v1",
      matched: true,
      manager,
      manifestDigest: authorization.manifestDigest,
      lockDigest: authorization.lockDigest,
      versions: { example: "2.0.0" },
    };
    expect(upgradeControlPasses(preset, authorization, resolution)).toBe(true);
    expect(upgradeControlPasses(preset, authorization, undefined)).toBe(false);
    expect(
      upgradeControlPasses(preset, authorization, {
        ...resolution,
        versions: { example: "1.0.0" },
      }),
    ).toBe(false);
    const tampered =
      candidate + (manager === "uv" ? '[tool.pytest]\naddopts="--ignore=tests"\n' : " ");
    if (manager === "uv")
      expect(
        upgradeControlPasses(
          preset,
          { ...authorization, candidate: tampered, manifestDigest: digestOfBytes(tampered) },
          { ...resolution, manifestDigest: digestOfBytes(tampered) },
        ),
      ).toBe(false);
    expect(
      upgradeControlPasses(preset, { ...authorization, touched: ["unrelated.txt"] }, resolution),
    ).toBe(false);
  },
);
