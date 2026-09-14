import { posix } from "node:path";
import { z } from "zod";
import { canonicalJson, digestOfJson } from "./canonical-json.ts";
import { toolNames } from "./run-spec.ts";

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
    version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    scopeKind: z.enum(["files", "workspace"]).optional(),
    taskId: nonEmpty,
    objective: nonEmpty,
    dependsOn: z.array(nonEmpty),
    /** At least one: a node that declares no files is a node whose scope nothing can check. */
    allowedPaths: z.array(nonEmpty).min(1),
    immutablePaths: z.array(nonEmpty),
    allowedTools: z.array(z.enum(toolNames)).min(1),
    network: z.enum(["denied", "mediated", "unrestricted"]),
    execution: z.enum(["restricted", "isolated"]).optional(),
    requiredChecks: z.array(nonEmpty),
    budget: z.strictObject({
      maxSteps: z.number().int().positive(),
      maxTokens: z.number().int().positive().optional(),
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
  const contract = parsed.data;
  const workspaceScope = contract.scopeKind === "workspace";
  if (
    workspaceScope &&
    (contract.version !== 3 ||
      contract.scopeAuthority !== "human" ||
      contract.allowedPaths.length !== 1 ||
      contract.allowedPaths[0] !== "**")
  )
    throw new MalformedTaskContractError(
      "workspace scope requires version 3, explicit human authority and exactly the workspace marker",
    );
  const allowedPaths = workspaceScope
    ? ["**"]
    : [...new Set(contract.allowedPaths.map(contractPath))].sort();
  const immutablePaths = [
    ...new Set(
      contract.immutablePaths.map((path) =>
        path.endsWith("/**") ? `${contractPath(path.slice(0, -3))}/**` : contractPath(path),
      ),
    ),
  ].sort();
  if (
    allowedPaths.some((path) => immutablePaths.some((immutable) => protectsPath(immutable, path)))
  ) {
    throw new MalformedTaskContractError("a path cannot be both writable and immutable");
  }
  return { ...contract, allowedPaths, immutablePaths };
}

/**
 * Keyed on what the work is and the tree it starts from, never on a clock. Two dispatches of
 * the same contract against the same base are the same work, which is what lets a resumed run
 * tell work it already did from work it still owes.
 */
export function idempotencyKeyFor(contract: TaskContract, baseCommit: string): string {
  return digestOfJson(
    JSON.parse(
      canonicalJson({
        baseCommit,
        contract: JSON.parse(canonicalJson(JSON.parse(JSON.stringify(contract)))),
      }),
    ),
  );
}

function valueAt(value: unknown, path: readonly PropertyKey[]): unknown {
  let here: unknown = value;
  for (const step of path) {
    if (here === null || typeof here !== "object") {
      return undefined;
    }
    // A read, never a write: this walk reaches a field named in a schema issue so the bad
    // value can be quoted back, and assigns nothing into the object it walks.
    // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
    here = (here as Record<PropertyKey, unknown>)[step];
  }
  return here;
}

/** Exact writable files; immutable directories may use a trailing slash or a recursive glob suffix. */
export function contractPath(value: string): string {
  const slashed = value.replaceAll("\\", "/");
  const normalized = posix.normalize(slashed);
  if (
    /^[a-zA-Z]:|^[/~]|[*?{}[\]]/.test(slashed) ||
    [...slashed].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new MalformedTaskContractError(
      `unsupported workspace-relative path ${JSON.stringify(value)}`,
    );
  }
  return normalized.replace(/\/$/, "");
}

export function protectsPath(immutable: string, path: string): boolean {
  const root = immutable.replace(/\/\*\*$/, "");
  return path === root || path.startsWith(`${root}/`);
}
