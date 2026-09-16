import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApprovalMode } from "./config/approval-mode.ts";
import { detectProject } from "./gates/project-type.ts";
import type { Glyphs } from "./tui/glyphs.ts";

/**
 * What a run has settled before the model is asked for anything, one line each: the
 * repository and the commit it is measured against, the manifest the gates assemble from, the
 * model and why it was chosen, and which prompts the run will answer itself. Printed before
 * the screen goes up, so it is still on the scrollback when the run is over (ADR 0011).
 */
export interface PreflightInput {
  readonly workspace: string;
  /** The home directory, so the workspace reads as `~/...` where it is under it. */
  readonly home: string;
  readonly baseCommit: string;
  readonly manifests: readonly string[];
  /** Null where a session has not yet read a task and so has nothing to choose a model for. */
  readonly model: { readonly spec: string; readonly reason: string } | null;
  readonly approval: ApprovalMode;
  readonly glyphs: Glyphs;
}

export function describePreflight(input: PreflightInput): readonly string[] {
  const { glyphs } = input;
  const line = (mark: string, label: string, text: string): string =>
    `${mark} ${label.padEnd(12)} ${text}`;
  return [
    line(
      glyphs.done,
      "repository",
      `${abbreviateHome(input.workspace, input.home)} at ${input.baseCommit.slice(0, 8)}`,
    ),
    input.manifests.length === 0
      ? line(glyphs.failed, "manifest", "none found")
      : line(glyphs.done, "manifest", input.manifests.join(", ")),
    input.model === null
      ? line(glyphs.pending, "model", "chosen when the first task is typed")
      : line(glyphs.done, "model", `${input.model.spec}  (${input.model.reason})`),
    line(glyphs.done, "approval", `${input.approval}  (${describeApproval(input.approval)})`),
  ];
}

function describeApproval(mode: ApprovalMode): string {
  return mode === "auto"
    ? "off-allowlist commands run without asking; a derivation match still asks"
    : "a on a prompt allows that program for this run; --approve auto answers allowlist prompts itself";
}

function abbreviateHome(path: string, home: string): string {
  return home.length > 0 && (path === home || path.startsWith(`${home}/`))
    ? `~${path.slice(home.length)}`
    : path;
}

/** The manifests the gates assemble from, by the same rule the gates use to find them. */
export async function manifestsIn(workspace: string): Promise<readonly string[]> {
  const detected = await detectProject((manifest) =>
    readFile(join(workspace, manifest), "utf8").catch(() => null),
  );
  return detected.manifests;
}
