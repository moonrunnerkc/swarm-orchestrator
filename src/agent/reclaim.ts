import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { gitText } from "./git.ts";

export interface Reclaimed {
  readonly path: string;
  /** Where what the action wrote was kept, relative to the workspace; null where it deleted it. */
  readonly kept: string | null;
}

const lines = (text: string) => text.split("\n").filter((line) => line.length > 0);

/**
 * The withheld checks' paths an action wrote or deleted, each put back as the starting tree had
 * it, with what the action wrote copied into `directory`. The harness lays a check at its path
 * only while it runs it, so a file the model leaves there is run by nothing and is delivered
 * against the user's own (fix-tracemantle-c4dc276c4, 2026-11-07).
 */
export async function reclaimWithheld(
  root: string,
  withheld: readonly string[],
  directory: string,
  name: string,
): Promise<Reclaimed[]> {
  if (withheld.length === 0) return [];
  const [changed, added] = await Promise.all([
    gitText(root, ["diff", "--name-only", "HEAD", "--", ...withheld]),
    gitText(root, ["ls-files", "--others", "--", ...withheld]),
  ]);
  const reclaimed: Reclaimed[] = [];
  for (const path of new Set([...lines(changed), ...lines(added)])) {
    const absolute = join(root, path);
    let kept: string | null = null;
    if (
      await stat(absolute).then(
        (found) => found.isFile(),
        () => false,
      )
    ) {
      await mkdir(directory, { recursive: true });
      const copy = join(directory, `${name}-${basename(path)}`);
      await copyFile(absolute, copy);
      kept = relative(root, copy);
    }
    const tracked = await gitText(root, ["cat-file", "-e", `HEAD:${path}`]).then(
      () => true,
      () => false,
    );
    if (tracked) await gitText(root, ["checkout", "HEAD", "--", path]);
    else await rm(absolute, { force: true });
    reclaimed.push({ path, kept });
  }
  return reclaimed;
}

/** A path beside a withheld check's for the model's own test, which the runner still collects. */
export function ownPath(path: string): string {
  const marked = /\.(?:test|spec)\.[^./]+$/.exec(path);
  if (marked !== null) return `${path.slice(0, marked.index)}.own${marked[0]}`;
  const dot = path.lastIndexOf(".");
  return dot > path.lastIndexOf("/")
    ? `${path.slice(0, dot)}_own${path.slice(dot)}`
    : `${path}_own`;
}

/**
 * What the model reads after the harness put a withheld path back. fix-tracemantle-c4dc276c4
 * (Arm B, rc.7, 2026-11-07) moved what it wrote back to the same path four times when told only
 * to use "a test path of your own"; this names one.
 */
export function reclaimNote(one: Reclaimed): string {
  const where = `another path, such as ${ownPath(one.path)}; anything written at ${one.path} is put back`;
  const next =
    one.kept === null
      ? `Write a test of your own at ${where}.`
      : `What you wrote is in ${one.kept}: move it from there to ${where}.`;
  return `\n[${one.path} holds an independent check the harness lays in only while it runs it, so the harness put the path back. ${next}]`;
}
