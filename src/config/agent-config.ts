import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml, TomlError } from "smol-toml";
import { z } from "zod";

/** swarm.toml is shared with the verifier; this reads only the agent's [agent] table. */
const swarmTomlFileName = "swarm.toml";

const positive = z.number().int().positive();

const agentSchema = z.strictObject({
  model: z.string().min(1).optional(),
  max_steps: positive.optional(),
  max_tokens: positive.optional(),
  turn_tokens: positive.optional(),
});

/**
 * Settings this file once held and no longer may. It is committed with the repository, so a
 * cloned project could approve its own commands, or name the server the user's key is sent to.
 */
const userOnly: Readonly<Record<string, string>> = {
  approval: "pass --approve auto on the command line",
  endpoint: "pass --endpoint <url> or set SWARM_ENDPOINT",
  api_key_env: "set the key as SWARM_API_KEY",
};

export interface AgentConfig {
  readonly model: string | null;
  readonly maxSteps: number | null;
  readonly maxTokens: number | null;
  readonly turnTokens: number | null;
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
  const moved = Object.keys(userOnly).find((key) => key in (table as object));
  if (moved !== undefined)
    throw new MalformedAgentConfigError(
      source,
      `agent.${moved} is no longer read from this file, which the repository controls; remove it and ${userOnly[moved]}`,
    );
  const parsed = agentSchema.safeParse(table);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = ["agent", ...(issue?.path ?? [])].join(".");
    throw new MalformedAgentConfigError(source, `${path}: ${issue?.message ?? ""}`);
  }
  const raw = parsed.data;
  return {
    model: raw.model ?? null,
    maxSteps: raw.max_steps ?? null,
    maxTokens: raw.max_tokens ?? null,
    turnTokens: raw.turn_tokens ?? null,
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
