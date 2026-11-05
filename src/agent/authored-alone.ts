import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Chokepoint } from "../tools/chokepoint.ts";
import {
  controlTitles,
  type FailingCase,
  onlyCase,
  plainOutput,
  removeLaid,
} from "./authored-cases.ts";
import type { AuthoredTest } from "./check-author.ts";

const printedError = /^(?:error|fatal|ERROR|FATAL)\b:? (.+)$/gm;

/**
 * The failing cases that pass when run alone at the base: their failure there came from what the
 * cases before them left behind, so no change to the code decides them. pubprep (2026-11-05, rc.13
 * and rc.17): a case read orchestrate's first mocked call, which an earlier case had made itself,
 * and failed on every tree; alone, it passed.
 */
export async function passingAlone(
  chokepoint: Chokepoint,
  workspace: string,
  test: Omit<AuthoredTest, "atBase">,
  cases: readonly FailingCase[],
): Promise<FailingCase[]> {
  const leaning: FailingCase[] = [];
  for (const one of cases) {
    const alone = onlyCase(test.command, one.title);
    if (alone === null) return [];
    await writeFile(join(workspace, test.path), test.content);
    const ran = await chokepoint
      .check(alone, `authored case "${one.title}", alone at the base`)
      .finally(() => removeLaid(workspace, test.path));
    if (ran.decision === "allowed" && ran.exitCode === 0) leaning.push(one);
  }
  return leaning;
}

/**
 * Why a control case, run alone at the base, shows the code refused before the work: it printed
 * an error, where a control drives behavior that succeeds now. A control passes by its own assertions, which
 * can hold with the work never reached. pubprep (2026-11-05 trial 10): main() ran in an empty
 * directory, printed that it is not a git repository and returned, and the control's assertion
 * on an orchestrate call that never came held anyway.
 */

export async function controlsRefused(
  chokepoint: Chokepoint,
  workspace: string,
  test: Omit<AuthoredTest, "atBase">,
): Promise<string | null> {
  for (const title of controlTitles(test.content)) {
    const alone = onlyCase(test.command, title);
    if (alone === null) return null;
    await writeFile(join(workspace, test.path), test.content);
    const ran = await chokepoint
      .check(alone, `authored control "${title}", alone at the base`)
      .finally(() => removeLaid(workspace, test.path));
    const printed = printedError.exec(plainOutput(ran.output));
    printedError.lastIndex = 0;
    if (printed !== null)
      return `its control case "${title}" makes the code print "${printed[0].trim().slice(0, 200)}" at the base: a control drives behavior that succeeds now, so the setup does not reach the code; set it up as the repository's own tests do`;
  }
  return null;
}
