import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import { swarmTomlFileName } from "./agent-config.ts";

/** Only the one key read here; the verifier validates the rest of its own tables. */
const verifyTable = z.object({
  verify: z.object({ setup: z.string().min(1).optional() }).optional(),
});

export class UnreadableSetupError extends Error {
  constructor(source: string, detail: string) {
    super(`${source} cannot be read for its [verify] setup: ${detail}. Fix the file`);
    this.name = "UnreadableSetupError";
  }
}

/**
 * The repository's recorded dependency command, `[verify] setup` in swarm.toml, or null where
 * there is no file or no such key. It is the verifier's setting; the agent reads it to prepare
 * the managed worktree the same way the verifier prepares its checkout.
 */
export async function declaredSetup(directory: string): Promise<string | null> {
  const source = join(directory, swarmTomlFileName);
  let text: string;
  try {
    text = await readFile(source, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
  let value: unknown;
  try {
    value = parseToml(text);
  } catch (error) {
    throw new UnreadableSetupError(
      source,
      error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error),
    );
  }
  const parsed = verifyTable.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new UnreadableSetupError(source, `${issue?.path.join(".")}: ${issue?.message ?? ""}`);
  }
  return parsed.data.verify?.setup ?? null;
}
