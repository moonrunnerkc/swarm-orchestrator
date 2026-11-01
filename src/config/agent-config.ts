import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml, TomlError } from "smol-toml";
import { z } from "zod";

/** swarm.toml is shared with the verifier; this reads only the agent's [agent] table. */
export const swarmTomlFileName = "swarm.toml";

const positive = z.number().int().positive();

const agentSchema = z.strictObject({
  endpoint: z.url({ protocol: /^https?$/ }).optional(),
  model: z.string().min(1).optional(),
  // The name of the variable holding the key, never the key: this file is committed.
  api_key_env: z
    .string()
    .regex(/^[A-Z_][A-Z0-9_]*$/)
    .optional(),
  max_steps: positive.optional(),
  max_tokens: positive.optional(),
  turn_tokens: positive.optional(),
  approval: z.enum(["ask", "auto"]).optional(),
});

export interface AgentConfig {
  readonly endpoint: string | null;
  readonly model: string | null;
  readonly apiKeyEnv: string | null;
  readonly maxSteps: number | null;
  readonly maxTokens: number | null;
  readonly turnTokens: number | null;
  /** Whether off-allowlist commands are approved by the run (auto) or by a person (ask). */
  readonly approval: "ask" | "auto" | null;
}

export class MalformedAgentConfigError extends Error {
  constructor(source: string, detail: string) {
    super(`${source} cannot be used: ${detail}. Fix its [agent] table or delete it.`);
    this.name = "MalformedAgentConfigError";
  }
}

export function parseAgentConfig(text: string, source: string): AgentConfig {
  let value: unknown;
  try {
    value = parseToml(text);
  } catch (error) {
    const where = error instanceof TomlError ? ` at line ${error.line}` : "";
    const message = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
    throw new MalformedAgentConfigError(source, `its TOML syntax is broken${where}: ${message}`);
  }
  const table = (value as { agent?: unknown }).agent ?? {};
  const parsed = agentSchema.safeParse(table);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = ["agent", ...(issue?.path ?? [])].join(".");
    throw new MalformedAgentConfigError(source, `${path}: ${issue?.message ?? ""}`);
  }
  const raw = parsed.data;
  return {
    endpoint: raw.endpoint ?? null,
    model: raw.model ?? null,
    apiKeyEnv: raw.api_key_env ?? null,
    maxSteps: raw.max_steps ?? null,
    maxTokens: raw.max_tokens ?? null,
    turnTokens: raw.turn_tokens ?? null,
    approval: raw.approval ?? null,
  };
}

/** The workspace's [agent] settings, or null where it has no swarm.toml. */
export async function readAgentConfig(workspace: string): Promise<AgentConfig | null> {
  const path = join(workspace, swarmTomlFileName);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
  return parseAgentConfig(text, path);
}
