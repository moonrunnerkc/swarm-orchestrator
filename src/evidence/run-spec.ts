import { z } from "zod";
import { canonicalJson, digestOfJson } from "./canonical-json.ts";
import type { EvidenceRecorder } from "./session.ts";

/**
 * Everything a run is measured by, fixed on the chain before the model is asked for anything.
 *
 * The gate-set seal already did this for gates, budgets and the ratchet arms. What it did not
 * cover is the rest of the envelope a result depends on: which commit the change is measured
 * against, which tools the run may use, which paths it may write and which it may not, whether
 * it may reach the network, whose signature a reader will expect, and what would need a person.
 * A result read without those is a result read without its question.
 *
 * Sealed once. A second seal would mean the run was measured by two specs and nothing could say
 * which, so widening means another run.
 */
export const toolNames = ["read", "write", "edit", "list", "search", "shell", "trail"] as const;

const nonEmpty = z.string().min(1);

const runSpecSchema = z.strictObject({
  version: z.literal(1),
  repository: z.strictObject({
    root: nonEmpty,
    /** The commit, not the name it was asked for: `HEAD` names whatever it points at later. */
    baseCommit: nonEmpty,
  }),
  task: nonEmpty,
  architecture: z.enum(["single-agent", "fixed-graph", "planned-graph", "redundant"]),
  model: z.strictObject({ spec: nonEmpty, pinned: z.boolean() }),
  tools: z.array(z.enum(toolNames)).min(1),
  network: z.enum(["denied", "mediated", "unrestricted"]),
  paths: z.strictObject({
    writable: z.array(nonEmpty),
    /** Paths no attempt may change, whatever it declares. */
    immutable: z.array(nonEmpty),
  }),
  /** A trusted task-specific check, where the run has one. Null is honest, not a default. */
  taskOracle: z.union([z.strictObject({ command: nonEmpty }), z.null()]),
  gates: z
    .array(
      z.strictObject({
        id: nonEmpty,
        severity: z.enum(["blocking", "advisory"]),
        capability: z.enum(["static", "dynamic", "policy", "task-oracle"]),
      }),
    )
    .min(1),
  budgets: z.strictObject({
    maxSteps: z.number().int().positive(),
    attempts: z.number().int().nonnegative(),
    maxWallMs: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
  }),
  retention: z.strictObject({ sessionsOlderThan: nonEmpty }),
  signer: z.strictObject({
    policy: z.enum(["any-key", "expected-signers"]),
    signers: z.array(nonEmpty),
  }),
  isolation: z.strictObject({
    mode: z.enum(["isolated", "restricted", "unsafe", "unknown"]),
    backend: nonEmpty,
  }),
  humanApproval: z.strictObject({ required: z.array(nonEmpty) }),
  versions: z.strictObject({ tool: nonEmpty, schema: z.number().int(), node: nonEmpty }),
});

export type RunSpec = z.infer<typeof runSpecSchema>;
export type RunSpecInput = z.input<typeof runSpecSchema>;

export class MalformedRunSpecError extends Error {
  constructor(problem: string) {
    super(
      `the run spec is not usable: ${problem}. A run is measured by its spec, so a spec that ` +
        "cannot be read is a run whose result could not be read either.",
    );
    this.name = "MalformedRunSpecError";
  }
}

export function parseRunSpec(value: unknown): RunSpec {
  const parsed = runSpecSchema.safeParse(value);
  if (!parsed.success) {
    throw new MalformedRunSpecError(
      parsed.error.issues
        .map((issue) => {
          const path = issue.path.join(".") || "(root)";
          // The value as well as the path. "tools.1: invalid option" tells a reader where to
          // look and not what is wrong there, and the offending word is the whole of the news.
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
 * The digest is over the canonical encoding, so two specs that say the same thing digest the
 * same however their fields were ordered, and any change to a bound field changes it.
 */
export function runSpecDigest(spec: RunSpec): string {
  return digestOfJson(JSON.parse(canonicalJson(spec)));
}

export interface SealedRunSpec {
  readonly spec: RunSpec;
  readonly digest: string;
}

export async function sealRunSpec(
  evidence: EvidenceRecorder,
  input: unknown,
): Promise<SealedRunSpec> {
  if (evidence.records().some((record) => record.type === "run-spec-sealed")) {
    throw new Error(
      "this run already sealed a spec. Sealing twice would mean the run was measured by two " +
        "specs and nothing could say which, so widening means another run.",
    );
  }
  const spec = parseRunSpec(input);
  const digest = runSpecDigest(spec);
  await evidence.record({
    type: "run-spec-sealed",
    actor: "harness",
    provenance: ["user"],
    payload: { digest, spec: JSON.parse(canonicalJson(spec)) },
  });
  return { spec, digest };
}
