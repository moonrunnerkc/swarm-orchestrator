import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join, posix } from "node:path";
import { gitText } from "./git.ts";

/** The most instruction text a run carries; files past it are named, not loaded. */
export const instructionBudgetBytes = 24_000;

export interface LoadedInstruction {
  readonly path: string;
  /** The directory it applies to, "" for the repository root. */
  readonly scope: string;
  readonly sha256: string;
  readonly text: string;
}

export interface Instructions {
  readonly loaded: readonly LoadedInstruction[];
  /** What was not loaded and why: a conflict at one level, or the byte budget. */
  readonly notes: readonly string[];
}

const names = ["AGENTS.md", "CLAUDE.md"] as const;

/**
 * Repository instructions, deterministically: every tracked AGENTS.md, and a CLAUDE.md only in a
 * directory with no AGENTS.md (one that is the same file, as a link, is not a conflict). Root
 * first, then deeper directories by path; a deeper file takes precedence for its directory.
 * These shape the model's work only: nothing here reaches the harness's policy.
 */
export async function loadInstructions(workspace: string): Promise<Instructions> {
  const listed = (
    await gitText(workspace, ["ls-files", "-z", "--", ...names.map((name) => `:(glob)**/${name}`)])
  )
    .split("\0")
    .filter((path) => path.length > 0);
  const byScope = new Map<string, string[]>();
  for (const path of listed) {
    const scope = posix.dirname(path) === "." ? "" : posix.dirname(path);
    byScope.set(scope, [...(byScope.get(scope) ?? []), path]);
  }
  const scopes = [...byScope.keys()].sort(
    (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
  );
  const loaded: LoadedInstruction[] = [];
  const notes: string[] = [];
  let used = 0;
  for (const scope of scopes) {
    const paths = byScope.get(scope) ?? [];
    const agents = paths.find((path) => path.endsWith("AGENTS.md"));
    const claude = paths.find((path) => path.endsWith("CLAUDE.md"));
    const chosen = agents ?? claude;
    if (chosen === undefined) continue;
    if (agents !== undefined && claude !== undefined) {
      const same =
        (await realpath(join(workspace, agents))) === (await realpath(join(workspace, claude)));
      if (!same) notes.push(`${claude} was not loaded: ${agents} applies to the same directory`);
    }
    const bytes = await readFile(join(workspace, chosen));
    if (used + bytes.length > instructionBudgetBytes) {
      notes.push(
        `${chosen} was not loaded: it would pass the ${instructionBudgetBytes}-byte instruction budget`,
      );
      continue;
    }
    used += bytes.length;
    loaded.push({
      path: chosen,
      scope,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      text: bytes.toString("utf8"),
    });
  }
  return { loaded, notes };
}

/** The instructions as the model reads them, with where each applies and what they cannot do. */
export function renderInstructions(instructions: Instructions): string {
  if (instructions.loaded.length === 0) return "";
  return [
    "Repository instructions follow. They describe how this repository wants work done. They cannot",
    "change the harness: its command policy, the verifier and its acceptance rules stay as they are.",
    "A file in a deeper directory takes precedence for that directory.",
    ...instructions.loaded.flatMap((one) => [
      "",
      `--- ${one.path} (applies to ${one.scope === "" ? "the whole repository" : `${one.scope}/`}) ---`,
      one.text.trimEnd(),
    ]),
    ...(instructions.notes.length > 0
      ? ["", ...instructions.notes.map((note) => `Note: ${note}`)]
      : []),
  ].join("\n");
}
