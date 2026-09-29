#!/usr/bin/env node
/**
 * The executable campaign manifest: every launch, in a seeded order fixed before any final
 * exposure. Comparison A is goal x condition x verifier arm (model-driven arms repeated);
 * Comparison B is goal x workflow arm x repetition. A launch an arm cannot natively run on a goal
 * is listed under `unsupported` with its reason, never dropped and never counted as a result.
 *
 *   node scripts/campaign/manifest.mjs --out <manifest.json> --protocol <path> --pins <pins.json>
 *     --unsupported-a <reasons.json> [--goals <id list>] [--set final|development|all]
 *     [--repetitions 3] [--seed <text>]
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { asJsonValue, digestOfBytes, digestOfJson } from "../../src/evidence/canonical-json.ts";
import { bSupport } from "./arms-b.mjs";
import { listFiles, loadGoalPackage } from "./goal-package.mjs";
import { comparisonAArms, comparisonBArms, manifestSchema } from "./schema.mjs";
import { campaignRoot } from "./workspace.mjs";

/** Arms that run on this host for Comparison A, by the capability matrix; the rest are unsupported. */
export const eligibleAArms = ["a-ci", "a-vera", "a-sv-s0", "a-sv-s1"];

export const defaultBudgets = {
  launchWallMs: 45 * 60_000,
  finalVerificationReserveMs: 8 * 60_000,
  tokens: 1_500_000,
  verifierMs: 30 * 60_000,
  infrastructureReruns: 2,
};

/** The digest of a goal package's files, so the manifest names exactly the material it froze. */
export function packageDigest(goalDirectory, hiddenDigest) {
  const files = listFiles(goalDirectory)
    .filter((path) => path !== "validation.json")
    .map((path) => ({ path, digest: digestOfBytes(readFileSync(join(goalDirectory, path))) }));
  return digestOfJson(asJsonValue({ files, hidden: hiddenDigest }));
}

const orderKey = (seed, id) => createHash("sha256").update(`${seed}\n${id}`).digest("hex");

export function buildManifest({
  loadedGoals,
  protocol,
  pins,
  seed,
  repetitions,
  budgets,
  unsupportedA,
}) {
  const launches = [];
  const unsupported = [];
  for (const { goal, contract } of loadedGoals) {
    for (const condition of goal.conditions)
      for (const arm of eligibleAArms)
        launches.push({
          comparison: "A",
          id: `a.${goal.id}.${condition.id}.${arm}.r1`,
          goal: goal.id,
          set: goal.set,
          repetition: 1,
          arm,
          condition: condition.id,
        });
    for (const arm of comparisonBArms) {
      const reason = bSupport(arm, contract);
      if (reason !== null) {
        unsupported.push({ comparison: "B", arm, goal: goal.id, reason });
        continue;
      }
      for (let repetition = 1; repetition <= repetitions; repetition += 1)
        launches.push({
          comparison: "B",
          id: `b.${goal.id}.${arm}.r${repetition}`,
          goal: goal.id,
          set: goal.set,
          repetition,
          arm,
        });
    }
  }
  for (const arm of comparisonAArms.filter((one) => !eligibleAArms.includes(one)))
    unsupported.push({ comparison: "A", arm, reason: unsupportedA[arm] });
  // Development launches come first; within a set, seeded order, repetitions of one cell apart.
  const sorted = launches.sort((left, right) =>
    left.set !== right.set
      ? left.set === "development"
        ? -1
        : 1
      : left.repetition !== right.repetition
        ? left.repetition - right.repetition
        : orderKey(seed, left.id).localeCompare(orderKey(seed, right.id)),
  );
  return manifestSchema.parse({
    schema: "swarm-campaign.manifest.v1",
    protocol,
    goalsDigest: digestOfJson(asJsonValue(loadedGoals.map((one) => one.frozen))),
    goals: loadedGoals.map((one) => one.frozen),
    orderSeed: seed,
    pins,
    budgets,
    launches: sorted.map((launch, order) => ({ ...launch, order })),
    unsupported,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const at = args.indexOf(name);
    return at === -1 ? fallback : args[at + 1];
  };
  const set = flag("--set", "all");
  const goalsRoot = join(campaignRoot, "goals");
  // The frozen goal list, one id per line; without it every goal package present is taken.
  const listed = flag("--goals");
  const ids =
    listed === undefined
      ? readdirSync(goalsRoot)
      : readFileSync(listed, "utf8")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
  const loadedGoals = ids
    .sort()
    .map((id) => loadGoalPackage(join(goalsRoot, id), { sealedRoot: join(campaignRoot, "sealed") }))
    .filter((loaded) => set === "all" || loaded.goal.set === set)
    .map((loaded) => ({
      ...loaded,
      frozen: {
        id: loaded.goal.id,
        set: loaded.goal.set,
        digest: packageDigest(join(goalsRoot, loaded.goal.id), loaded.goal.hidden.digest),
      },
    }));
  const protocolPath = flag("--protocol", "docs/verifier-first/campaign-protocol-2026-09-29.md");
  const manifest = buildManifest({
    loadedGoals,
    protocol: { path: protocolPath, digest: digestOfBytes(readFileSync(protocolPath)) },
    pins: JSON.parse(readFileSync(flag("--pins"), "utf8")),
    seed: flag("--seed", "swarm-campaign-2026-09-29"),
    repetitions: Number(flag("--repetitions", "3")),
    budgets: defaultBudgets,
    unsupportedA: JSON.parse(readFileSync(flag("--unsupported-a"), "utf8")),
  });
  writeFileSync(resolve(flag("--out")), `${JSON.stringify(manifest, null, 1)}\n`, { flag: "wx" });
  console.log(
    `${manifest.launches.length} launches (${manifest.launches.filter((one) => one.comparison === "A").length} A, ${manifest.launches.filter((one) => one.comparison === "B").length} B), ${manifest.unsupported.length} unsupported`,
  );
}
