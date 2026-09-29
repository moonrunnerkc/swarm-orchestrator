/**
 * Reading a goal package and its sealed hidden oracle from disk, with every cross-file rule the
 * schema alone cannot state: the visible contract parses as a version-1 goal contract, its
 * acceptance artifacts sit where no patch reaches, the task text is the same bytes everywhere it
 * is quoted, and the hidden oracle's digest is the one the goal was frozen with.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { asJsonValue, digestOfBytes, digestOfJson } from "../../src/evidence/canonical-json.ts";
import { freezeGoalContract } from "../../src/evidence/goal-contract.ts";
import { pathsInPatch } from "../../src/gates/patch-paths.ts";
import { goalSchema, hiddenOracleSchema } from "./schema.mjs";

export class GoalPackageError extends Error {
  constructor(message) {
    super(message);
    this.name = "GoalPackageError";
  }
}

/**
 * The sealed oracle's identity: its declaration and the digest of every file it copies, so a
 * change to one byte of a hidden test changes the digest the frozen goal names.
 */
export function sealedDigest(sealedDirectory) {
  const declaration = hiddenOracleSchema.parse(
    JSON.parse(readFileSync(join(sealedDirectory, "oracle.json"), "utf8")),
  );
  const files = declaration.files.map((file) => {
    const path = join(sealedDirectory, file.from);
    if (!existsSync(path) || !statSync(path).isFile())
      throw new GoalPackageError(`sealed oracle file ${file.from} is missing`);
    return { from: file.from, to: file.to, digest: digestOfBytes(readFileSync(path)) };
  });
  return {
    declaration,
    digest: digestOfJson(asJsonValue({ declaration, files })),
  };
}

/** Every file under a directory, relative to it, in a stable order. */
export function listFiles(directory) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) out.push(relative(directory, path));
    }
  };
  walk(directory);
  return out;
}

/**
 * A leak is judged on content lines, not bytes: a patch prefixes every line it adds, so the
 * oracle's file never appears in it verbatim. Three or more of the oracle's own distinctive lines
 * added by one patch is a copy, not a coincidence of short common lines such as `});`.
 */
const leakThreshold = 3;
const distinctiveLines = (text) =>
  [...new Set(text.split("\n").map((line) => line.trim()))].filter((line) => line.length >= 24);
const addedLines = (patch) =>
  patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1).trim());

/** The contract's own rule: an immutable path protects itself and everything beneath it. */
const protects = (immutable, path) => path === immutable || path.startsWith(`${immutable}/`);

/**
 * Load one goal package. `sealedRoot` is where hidden oracles live; pass null to skip the
 * sealed-digest comparison (a reader with no access to the sealed material, such as an arm).
 */
export function loadGoalPackage(goalDirectory, { sealedRoot = null } = {}) {
  const goalPath = join(goalDirectory, "goal.json");
  if (!existsSync(goalPath)) throw new GoalPackageError(`${goalPath} does not exist`);
  const parsed = goalSchema.safeParse(JSON.parse(readFileSync(goalPath, "utf8")));
  if (!parsed.success)
    throw new GoalPackageError(
      `${goalPath}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  const goal = parsed.data;
  const read = (path) => {
    const full = join(goalDirectory, path);
    if (!existsSync(full)) throw new GoalPackageError(`${goal.id}: ${path} is missing`);
    return readFileSync(full, "utf8");
  };
  const taskFile = read("task.md");
  if (taskFile.trimEnd() !== goal.taskText.trimEnd())
    throw new GoalPackageError(`${goal.id}: task.md and goal.json taskText differ`);
  let frozen;
  try {
    frozen = freezeGoalContract(JSON.parse(read(goal.contract)));
  } catch (cause) {
    throw new GoalPackageError(
      `${goal.id}: the visible contract does not freeze: ${cause.message}`,
    );
  }
  const contract = frozen.contract;
  if (contract.checks.some((check) => check.author !== "user" || check.exposure !== "shared"))
    throw new GoalPackageError(`${goal.id}: every visible check is user-authored and shared`);
  const presetKind = contract.preset?.kind ?? "feature";
  const expectedPreset = goal.workType === "feature" ? "feature" : goal.workType;
  if (presetKind !== expectedPreset)
    throw new GoalPackageError(
      `${goal.id}: work type ${goal.workType} needs preset ${expectedPreset}, not ${presetKind}`,
    );
  const artifactPaths = contract.checks.flatMap((check) => check.artifacts.map((a) => a.path));
  for (const path of artifactPaths)
    if (!path.startsWith("acceptance/visible/"))
      throw new GoalPackageError(
        `${goal.id}: visible artifact ${path} is outside acceptance/visible/`,
      );
  const patches = new Map();
  patches.set("reference", read(goal.reference));
  for (const condition of goal.conditions) patches.set(condition.id, read(condition.patch));
  for (const [name, patch] of patches) {
    const touched = pathsInPatch(patch);
    if (touched.length === 0 && name !== "reference")
      throw new GoalPackageError(`${goal.id}/${name}: the patch changes nothing`);
    const reached = touched.filter(
      (path) =>
        artifactPaths.some((artifact) => artifact === path) || path.startsWith(".hidden-oracle/"),
    );
    if (reached.length > 0)
      throw new GoalPackageError(
        `${goal.id}/${name}: the patch reaches acceptance or oracle paths: ${reached.join(", ")}`,
      );
  }
  const correct = goal.conditions.find((one) => one.id === "correct");
  if (correct === undefined || patches.get("correct") !== patches.get("reference"))
    throw new GoalPackageError(`${goal.id}: the condition named correct is the reference patch`);
  let sealed = null;
  if (sealedRoot !== null) {
    sealed = sealedDigest(join(sealedRoot, goal.id));
    if (sealed.declaration.goal !== goal.id)
      throw new GoalPackageError(`${goal.id}: the sealed oracle names ${sealed.declaration.goal}`);
    if (sealed.digest !== goal.hidden.digest)
      throw new GoalPackageError(
        `${goal.id}: sealed oracle digest ${sealed.digest} is not the frozen ${goal.hidden.digest}`,
      );
    if (sealed.declaration.files.some((file) => !file.to.startsWith(".hidden-oracle/")))
      throw new GoalPackageError(`${goal.id}: the oracle copies files outside .hidden-oracle/`);
    const distinctive = sealed.declaration.files.flatMap((file) =>
      distinctiveLines(readFileSync(join(sealedRoot, goal.id, file.from), "utf8")),
    );
    for (const [name, patch] of patches) {
      const added = new Set(addedLines(patch));
      if (distinctive.filter((line) => added.has(line)).length >= leakThreshold)
        throw new GoalPackageError(`${goal.id}/${name}: the patch carries hidden oracle bytes`);
    }
  }
  const immutable = contract.immutablePaths;
  return {
    goal,
    contract,
    contractDigest: frozen.digest,
    patches,
    sealed,
    immutableTouchedBy: (name) =>
      pathsInPatch(patches.get(name)).filter((path) =>
        immutable.some((entry) => protects(entry, path)),
      ),
  };
}
