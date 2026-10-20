import { readFile } from "node:fs/promises";
import {
  freezeGoalContract,
  type GoalContract,
  goalImmutablePaths,
} from "./evidence/goal-contract.ts";
import { parseTaskContract, type TaskContract } from "./evidence/task-contract.ts";

/** Preserve user obligations and narrow upgrade authority on the ordinary task path. */
export function presetTaskContract(options: {
  goal: GoalContract;
  task: string;
  originalObjective?: string;
  maxSteps: number;
  maxWallMs: number;
  network: "denied" | "unrestricted";
  /**
   * Planned requirements no retained generated check covers, as planning reconciled them. They
   * stay in the brief with why and what to do: a rejected check is a rejected instrument, and the
   * behaviour the task asked for is still part of the work. Labelled as the planner's reading.
   */
  uncovered?: readonly {
    readonly id: string;
    readonly quote: string | null;
    readonly reason: string;
    readonly nextAction: string;
  }[];
  /**
   * Requested outcomes no retained generated check states, each under its requirement. A
   * requirement can have a covered outcome beside an unresolved one; only the second is here.
   */
  unresolvedOutcomes?: readonly {
    readonly id: string;
    readonly requirement: string;
    readonly quote: string | null;
    readonly role: "change" | "keep";
    /** Inputs the task names that the outcome was stated with, and what was seen for each. */
    readonly taskInputs?: readonly {
      readonly input: unknown;
      readonly expected: string;
      readonly base: string | null;
    }[];
    readonly reason: string;
    readonly nextAction: string;
  }[];
}): TaskContract {
  const { goal } = options;
  const upgrade = goal.preset?.kind === "upgrade" ? goal.preset : undefined;
  return parseTaskContract({
    version: 3,
    scopeKind: upgrade === undefined ? "workspace" : "files",
    taskId: "preset",
    objective:
      options.originalObjective ??
      `${options.task}\nSealed objective: ${goal.goal}\nRequired behavior: ${JSON.stringify(goal.requirements.map(({ id, description }) => ({ id, description })))}\nPreset: ${JSON.stringify(goal.preset ?? null)}${uncoveredSection(options.uncovered ?? [], options.unresolvedOutcomes ?? [])}`,
    dependsOn: [],
    allowedPaths:
      upgrade === undefined ? ["**"] : [upgrade.manifest, upgrade.lockfile, ...upgrade.sourcePaths],
    immutablePaths: [...goalImmutablePaths(goal)],
    allowedTools: ["read", "write", "edit", "list", "search", "shell"],
    network: options.network,
    requiredChecks: ["task-acceptance"],
    budget: { maxSteps: options.maxSteps, maxWallMs: options.maxWallMs },
    riskTier: "medium",
    scopeAuthority: "human",
  });
}

function uncoveredSection(
  uncovered: NonNullable<Parameters<typeof presetTaskContract>[0]["uncovered"]>,
  outcomes: NonNullable<Parameters<typeof presetTaskContract>[0]["unresolvedOutcomes"]>,
): string {
  // A requirement with no check at all is named once, by its outcomes where it has any.
  const requirements = uncovered.filter(
    (one) => !outcomes.some((outcome) => outcome.requirement === one.id),
  );
  if (requirements.length === 0 && outcomes.length === 0) return "";
  return [
    "",
    "Requested behaviour no generated check exercises (the planner's reading of the task; nothing will exercise these for you, and another check under the same requirement does not):",
    ...outcomes.map(
      (one) =>
        `- ${one.id}, ${one.role === "change" ? "a change" : "behaviour to keep"} under requirement ${one.requirement}${one.quote === null ? "" : `, quoting the task: ${JSON.stringify(one.quote)}`}.` +
        // The task's own input, by name: a requirement's description is whichever check declared it
        // last, and the launch that found this told its worker about angle-bracket links instead.
        ((one.taskInputs ?? []).length === 0
          ? ""
          : ` The task's own input: ${(one.taskInputs ?? []).map((asked) => `${JSON.stringify(asked.input)} (the planner first expected ${asked.expected}${asked.base === null ? "" : `; the unchanged base gives ${asked.base}`})`).join(", ")}.`) +
        ` Why: ${one.reason}. Next: ${one.nextAction}.`,
    ),
    ...requirements.map(
      (one) =>
        `- ${one.id}${one.quote === null ? "" : `, quoting the task: ${JSON.stringify(one.quote)}`}. Why: ${one.reason}. Next: ${one.nextAction}.`,
    ),
  ].join("\n");
}

/** The sealed contract a run was handed, or an error that names the file and what is wrong with it. */
export async function readGoalContractFile(path: string): Promise<GoalContract> {
  const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error(`--goal-contract ${path} cannot be read: ${describe(cause)}`, { cause });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(`--goal-contract ${path} is not JSON: ${describe(cause)}`, { cause });
  }
  try {
    return freezeGoalContract(parsed).contract;
  } catch (cause) {
    throw new Error(`--goal-contract ${path} is not a valid goal contract: ${describe(cause)}`, {
      cause,
    });
  }
}

/**
 * A preset is named in two places or in neither. The contract's preset carries the policy the
 * verifier enforces (base controls, invariants, upgrade scope), and the flag is the operator
 * saying they meant it; a contract whose preset the command line did not name is not silently
 * run under that policy, and a flag the contract does not back cannot invent one.
 */
export function assertPresetSelection(
  flag: "bugfix" | "refactor" | "upgrade" | undefined,
  contract: GoalContract,
): void {
  const sealed = contract.preset?.kind;
  if (flag === sealed) return;
  if (flag === undefined)
    throw new Error(
      `the goal contract names the ${sealed} preset; pass --preset ${sealed} to run under that policy` +
        (sealed === "upgrade" ? " (with --install)" : ""),
    );
  if (sealed === undefined)
    throw new Error(
      `--preset ${flag} was named but the goal contract carries no preset; a general task runs ` +
        "without --preset, and a preset task seals its preset in the contract",
    );
  throw new Error(
    `--preset ${flag} does not match the ${sealed} preset sealed in the goal contract`,
  );
}
