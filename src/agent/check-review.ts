import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Requirement } from "swarm-verify";
import type { Chokepoint } from "../tools/chokepoint.ts";
import type { Authored } from "./check-author.ts";
import { claimsFile, claimsIn, type Supplied } from "./supplied.ts";
import type { TestConventions } from "./test-conventions.ts";
import { type UserCheck, validateSupplied } from "./user-checks.ts";

type Claim = Requirement["evidence"]["structure"][number];
type Test = NonNullable<Authored["test"]>;
/** A structure claim with the requirement it witnesses. */
export interface HeldClaim {
  readonly requirement: string;
  readonly claim: Claim;
}

/** One authored check shown to the user, written to `file` for them to edit in place. */
interface ShownCheck {
  readonly requirement: string;
  readonly path: string;
  readonly file: string;
  readonly content: string;
  /** Why the last edit was refused, where it was. */
  readonly problem: string | null;
}
export type CheckReviewer = (shown: ShownCheck) => Promise<"approve" | "edit" | "reject">;

/** Claims of one requirement as the file the user reads, edits and supplies back. */
const claimSets = (structure: readonly HeldClaim[]) =>
  [...new Set(structure.map((one) => one.requirement))].map((requirement) => ({
    requirement,
    path: claimsFile(requirement),
    content: `${JSON.stringify(
      structure.filter((one) => one.requirement === requirement).map((one) => one.claim),
      null,
      2,
    )}\n`,
  }));

/** R1's files at the directory's root; an obligation's under a directory of its id. */
const placed = (requirement: string, path: string) =>
  requirement === "R1" ? path : join(requirement, path);

/** The authored checks written out for the user to read, edit and supply back with `--accept`. */
export async function writeOut(
  directory: string,
  tests: readonly Test[],
  structure: readonly HeldClaim[],
): Promise<string[]> {
  const files = [
    ...tests.map((test) => ({ path: placed(test.requirement, test.path), content: test.content })),
    ...claimSets(structure).map((one) => ({ path: one.path, content: one.content })),
  ];
  for (const file of files) {
    const target = join(directory, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  return files.map((file) => file.path);
}

/**
 * Each authored check shown to the user in turn. An approved or edited one becomes the user's
 * own (`user-acceptance`): a person stands behind it now. An edit is run at the base again, as
 * any supplied check is, and shown again with the reason where it is refused.
 */
export async function review(
  input: {
    readonly chokepoint: Chokepoint;
    readonly workspace: string;
    readonly scratch: string;
  },
  reviewer: CheckReviewer,
  tests: readonly Test[],
  structure: readonly HeldClaim[],
  conventions: TestConventions | null,
): Promise<{ readonly user: UserCheck[]; readonly claims: readonly HeldClaim[] }> {
  const shown = [
    ...tests.map((test) => ({ ...test, claims: false })),
    ...claimSets(structure).map((one) => ({ ...one, claims: true })),
  ];
  const user: UserCheck[] = [];
  const claims: HeldClaim[] = [];
  for (const one of shown) {
    const file = join(input.scratch, "review", placed(one.requirement, one.path));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, one.content);
    let problem: string | null = null;
    while (true) {
      const content = await readFile(file, "utf8");
      const answer = await reviewer({ ...one, file, content, problem });
      if (answer === "reject") break;
      const edited = await readFile(file, "utf8");
      const read = one.claims ? claimsOf(edited, one.path) : null;
      if (typeof read === "string") {
        problem = read;
        continue;
      }
      const supplied: Supplied =
        read === null
          ? { kind: "file", requirement: one.requirement, path: one.path, content: edited }
          : { kind: "claims", requirement: one.requirement, source: one.path, claims: read };
      const checked = await validateSupplied({ ...input, conventions, supplied: [supplied] });
      problem = checked.refused[0] ?? null;
      if (problem !== null) continue;
      claims.push(...checked.claims);
      user.push(
        ...checked.checks.map((check) => ({
          ...check,
          name: `reviewed-${one.requirement}-${user.length + 1}`,
        })),
      );
      break;
    }
  }
  return { user, claims };
}

/** The claims an edited file holds, as the user's, or why it holds none. */
function claimsOf(text: string, source: string): Claim[] | string {
  try {
    return claimsIn(text, source) ?? "it is not JSON";
  } catch (error) {
    return (error as Error).message;
  }
}
