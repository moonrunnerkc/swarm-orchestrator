/**
 * What a gate is capable of establishing, which is not the same as whether it ran a command.
 *
 * A lint run and a test run are both a command the harness spawned, and reading them alike is
 * how a change nothing executed comes to read green: linting proves the source parses and says
 * nothing about whether any of it was ever run. So the question a verdict asks is not "did a
 * command gate run" but "did anything execute the changed code".
 *
 *   static      reads the source without executing it: lint, typecheck, format.
 *   dynamic     executes the code under change: the tests gate, a behaviour probe.
 *   policy      rules on the change without executing or judging it: secrets, placeholders,
 *               the declared file set, the diff budget.
 *   task-oracle a trusted check specific to this task. Nothing assembles one today.
 */
export type GateCapability = "static" | "dynamic" | "policy" | "task-oracle";

/**
 * Read off the gate's id rather than a list of gates (invariant 6: engine logic never
 * special-cases a gate). A gate assembled per language carries its language as a suffix, so
 * `tests:python` is the tests gate and is classified as one.
 */
const capabilityByBaseId: Readonly<Record<string, GateCapability>> = {
  tests: "dynamic",
  "behaviour-probe": "dynamic",
  typecheck: "static",
  lint: "static",
  format: "static",
  "secret-scan": "policy",
  placeholder: "policy",
  "file-set": "policy",
  "diff-budget": "policy",
};

/**
 * An unrecognized id is static, which is the conservative direction: a gate nobody classified
 * cannot be the thing that establishes the change was executed. A custom gate that does run
 * the code declares itself dynamic rather than being guessed at.
 */
export function capabilityOf(gateId: string): GateCapability {
  return capabilityByBaseId[baseIdOf(gateId)] ?? "static";
}

/**
 * Whether the id was classified rather than defaulted. A gate the table does not name falls to
 * static, which is the safe direction and is still a guess; a test holds the assembled set to
 * being named, so adding a gate without classifying it fails here rather than quietly deciding
 * that it does not execute anything.
 */
export function isClassified(gateId: string): boolean {
  return baseIdOf(gateId) in capabilityByBaseId;
}

function baseIdOf(gateId: string): string {
  return gateId.split(":")[0] ?? gateId;
}
