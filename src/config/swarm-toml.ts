import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml, TomlError } from "smol-toml";
import { z } from "zod";

export const swarmTomlFileName = "swarm.toml";

/** What a protected-path allowance can name. */
export const protectedCategories = ["tests", "ci", "lockfiles", "manifests", "config"] as const;
export type ProtectedCategory = (typeof protectedCategories)[number];

const nonEmpty = z.string().min(1);
const positive = z.number().int().positive();

const fileSchema = z.strictObject({
  checks: z
    .record(
      nonEmpty,
      z.union([
        nonEmpty,
        z.strictObject({ command: nonEmpty, kind: z.enum(["test", "other"]).optional() }),
      ]),
    )
    .optional(),
  protect: z.strictObject({ allow: z.array(z.enum(protectedCategories)).optional() }).optional(),
  verify: z
    .strictObject({ setup: nonEmpty.optional(), timeout_minutes: positive.optional() })
    .optional(),
  agent: z
    .strictObject({
      endpoint: z.url({ protocol: /^https?$/ }).optional(),
      model: nonEmpty.optional(),
      // The name of the variable holding the key, never the key: this file is committed.
      api_key_env: z
        .string()
        .regex(/^[A-Z_][A-Z0-9_]*$/)
        .optional(),
      max_steps: positive.optional(),
      max_tokens: positive.optional(),
    })
    .optional(),
});

export interface DeclaredCheck {
  readonly name: string;
  readonly command: string;
  readonly kind: "test" | "other";
}

export interface SwarmToml {
  readonly checks: readonly DeclaredCheck[];
  readonly allow: readonly ProtectedCategory[];
  readonly setup: string | null;
  readonly timeoutMinutes: number;
  readonly agent: {
    readonly endpoint: string | null;
    readonly model: string | null;
    readonly apiKeyEnv: string | null;
    readonly maxSteps: number | null;
    readonly maxTokens: number | null;
  };
}

export class MalformedSwarmTomlError extends Error {
  constructor(source: string, detail: string) {
    super(`${source} cannot be used: ${detail}. Fix the file or delete it.`);
    this.name = "MalformedSwarmTomlError";
  }
}

export function parseSwarmToml(text: string, source: string): SwarmToml {
  let value: unknown;
  try {
    value = parseToml(text);
  } catch (error) {
    const where = error instanceof TomlError ? ` at line ${error.line}` : "";
    const message = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
    throw new MalformedSwarmTomlError(source, `its TOML syntax is broken${where}: ${message}`);
  }
  const parsed = fileSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") ?? "";
    throw new MalformedSwarmTomlError(source, `${path || "the file"}: ${issue?.message ?? ""}`);
  }
  const raw = parsed.data;
  return {
    checks: Object.entries(raw.checks ?? {}).map(([name, entry]) => {
      const command = typeof entry === "string" ? entry : entry.command;
      const declared = typeof entry === "string" ? undefined : entry.kind;
      return { name, command, kind: declared ?? (name === "test" ? "test" : "other") };
    }),
    allow: raw.protect?.allow ?? [],
    setup: raw.verify?.setup ?? null,
    timeoutMinutes: raw.verify?.timeout_minutes ?? 20,
    agent: {
      endpoint: raw.agent?.endpoint ?? null,
      model: raw.agent?.model ?? null,
      apiKeyEnv: raw.agent?.api_key_env ?? null,
      maxSteps: raw.agent?.max_steps ?? null,
      maxTokens: raw.agent?.max_tokens ?? null,
    },
  };
}

/** The workspace's swarm.toml, or null where it has none. */
export async function readSwarmToml(workspace: string): Promise<SwarmToml | null> {
  const path = join(workspace, swarmTomlFileName);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
  return parseSwarmToml(text, path);
}
