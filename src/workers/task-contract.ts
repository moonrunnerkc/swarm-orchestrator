import { z } from "zod";
import { canonicalJson, digestOfJson } from "../evidence/canonical-json.ts";
import { toolNames } from "../evidence/run-spec.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";

/**
 * What one node of a decomposition was allowed to do, and what it was for.
 *
 * The task graph already declares an id, an instruction, dependencies and intended files, and
 * invariant 15 checks the shape of the graph. What it does not say is the envelope the node runs
 * under: which tools it may use, which paths it may never touch whatever it declares, what has
 * to pass before its work counts, what it may spend, and who may widen any of that. Those are
 * the things a reviewer needs to weigh a node's result, and a node whose envelope nobody wrote
 * down is a node whose result is read against whatever the reader assumes.
 */
const nonEmpty = z.string().min(1);

const taskContractSchema = z
  .strictObject({
    version: z.literal(1),
    taskId: nonEmpty,
    objective: nonEmpty,
    dependsOn: z.array(nonEmpty),
    /** At least one: a node that declares no files is a node whose scope nothing can check. */
    allowedPaths: z.array(nonEmpty).min(1),
    immutablePaths: z.array(nonEmpty),
    allowedTools: z.array(z.enum(toolNames)).min(1),
    network: z.enum(["denied", "mediated", "unrestricted"]),
    requiredChecks: z.array(nonEmpty),
    budget: z.strictObject({
      maxSteps: z.number().int().positive(),
      maxWallMs: z.number().int().positive(),
    }),
    /** What a failure here would cost, which is what decides whether a person is asked. */
    riskTier: z.enum(["low", "medium", "high"]),
    /** Who may widen this contract. A worker never widens its own. */
    scopeAuthority: z.enum(["controller", "human"]),
  })
  .refine(
    (contract) => !contract.allowedPaths.some((path) => contract.immutablePaths.includes(path)),
    { message: "a path cannot be both writable and immutable; one of the two is a lie" },
  );

export type TaskContract = z.infer<typeof taskContractSchema>;

export class MalformedTaskContractError extends Error {
  constructor(problem: string) {
    super(`the task contract is not usable: ${problem}`);
    this.name = "MalformedTaskContractError";
  }
}

export function parseTaskContract(value: unknown): TaskContract {
  const parsed = taskContractSchema.safeParse(value);
  if (!parsed.success) {
    throw new MalformedTaskContractError(
      parsed.error.issues
        .map((issue) => {
          const path = issue.path.join(".") || "(root)";
          const found = valueAt(value, issue.path);
          return found === undefined
            ? `${path}: ${issue.message}`
            : `${path}: ${issue.message} (found ${JSON.stringify(found)})`;
        })
        .join("; "),
    );
  }
  return parsed.data;
}

/**
 * Keyed on what the work is and the tree it starts from, never on a clock. Two dispatches of
 * the same contract against the same base are the same work, which is what lets a resumed run
 * tell work it already did from work it still owes.
 */
export function idempotencyKeyFor(contract: TaskContract, baseCommit: string): string {
  return digestOfJson(
    JSON.parse(canonicalJson({ baseCommit, contract: JSON.parse(canonicalJson(contract)) })),
  );
}

interface GraphLike {
  readonly nodes: readonly {
    readonly id: string;
    readonly instruction: string;
    readonly dependsOn: readonly string[];
    readonly files: readonly string[];
  }[];
}

/** One contract per declared node, so the graph and the envelope cannot describe different runs. */
export function contractsFromGraph(
  graph: GraphLike,
  defaults: {
    readonly maxSteps: number;
    readonly maxWallMs: number;
    readonly immutablePaths: readonly string[];
    readonly allowedTools?: readonly TaskContract["allowedTools"][number][];
    readonly requiredChecks?: readonly string[];
  },
): readonly TaskContract[] {
  return graph.nodes.map((node) =>
    parseTaskContract({
      version: 1,
      taskId: node.id,
      objective: node.instruction,
      dependsOn: [...node.dependsOn],
      allowedPaths: [...node.files],
      immutablePaths: [...defaults.immutablePaths],
      allowedTools: [
        ...(defaults.allowedTools ?? ["read", "write", "edit", "list", "search", "shell"]),
      ],
      network: "denied",
      requiredChecks: [...(defaults.requiredChecks ?? [])],
      budget: { maxSteps: defaults.maxSteps, maxWallMs: defaults.maxWallMs },
      // Every node is medium until something measures otherwise. Assuming low is the direction
      // that skips a person, so it is not the direction an unmeasured default goes.
      riskTier: "medium",
      scopeAuthority: "controller",
    }),
  );
}

function valueAt(value: unknown, path: readonly PropertyKey[]): unknown {
  let here: unknown = value;
  for (const step of path) {
    if (here === null || typeof here !== "object") {
      return undefined;
    }
    here = (here as Record<PropertyKey, unknown>)[step];
  }
  return here;
}

/**
 * One record per node, on the coordinator's chain beside the graph declaration. The graph says
 * what the nodes are; the contract says what each was allowed to do while doing it, and a
 * reader weighing a node's result needs both.
 */
export async function declareTaskContracts(
  evidence: EvidenceRecorder,
  contracts: readonly TaskContract[],
  baseCommit: string,
): Promise<void> {
  for (const contract of contracts) {
    await evidence.record({
      type: "task-contract",
      actor: "harness",
      // The envelope is the harness's, whoever wrote the graph inside it.
      provenance: ["user"],
      payload: {
        ...JSON.parse(canonicalJson(contract)),
        idempotencyKey: idempotencyKeyFor(contract, baseCommit),
        baseCommit,
      },
    });
  }
}
