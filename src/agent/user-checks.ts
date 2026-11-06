import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type Requirement, sealFiles, structureEvidence, type TrustedCheck } from "swarm-verify";
import type { Chokepoint } from "../tools/chokepoint.ts";
import { testPattern } from "./affected-tests.ts";
import { plainOutput, removeLaid } from "./authored-cases.ts";
import type { Supplied } from "./supplied.ts";
import type { TestConventions } from "./test-conventions.ts";

type Claim = Requirement["evidence"]["structure"][number];

/** A user's check as the harness runs it: a laid test file, or a command, and what it witnesses. */
export interface UserCheck {
  /** The requirement it witnesses; null for a behavior-preservation check (`keep=`). */
  readonly requirement: string | null;
  readonly name: string;
  readonly command: string;
  /** The file laid at this path while it runs, and taken out again; null for a command. */
  readonly path: string | null;
  readonly content: string | null;
  /** Files supplied beside the tests that are not tests (fixtures they read), laid with every run. */
  readonly support?: readonly LaidFile[];
  /** The end of what it printed at the base. */
  readonly atBase: string;
}

export interface LaidFile {
  readonly path: string;
  readonly content: string;
}

export interface Validated {
  readonly checks: readonly UserCheck[];
  /** Structure claims for R1, each holding or not at the base; at least one must not. */
  readonly claims: readonly Claim[];
  /** Why a supplied check cannot witness what it was supplied for, one line each. */
  readonly refused: readonly string[];
}

/**
 * Lays a file at its path for one run and puts back whatever was there: the base's file, or the
 * model's version of it, or nothing.
 */
export async function laid<T>(
  workspace: string,
  files: readonly LaidFile[],
  run: () => Promise<T>,
): Promise<T> {
  const before: (Buffer | null)[] = [];
  for (const file of files) {
    const absolute = join(workspace, file.path);
    before.push(await readFile(absolute).catch(() => null));
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, file.content);
  }
  try {
    return await run();
  } finally {
    for (const [at, file] of files.entries()) {
      const was = before[at] ?? null;
      if (was === null) await removeLaid(workspace, file.path);
      else await writeFile(join(workspace, file.path), was);
    }
  }
}

const notCollected =
  /No test files found|no tests ran|collected 0 items|file or directory not found|No tests found/i;
const unparsable = /(?:SyntaxError|IndentationError)(?!: The requested module)|Transform failed/;

/** Runs one user check on the tree as it stands: the file laid while it runs, or the command alone. */
export async function runUserCheck(
  chokepoint: Chokepoint,
  workspace: string,
  check: Pick<UserCheck, "command" | "path" | "content" | "name" | "support">,
  purpose: string,
) {
  const go = () => chokepoint.check(check.command, `${purpose}: ${check.name}`);
  return check.path === null || check.content === null
    ? go()
    : laid(workspace, [{ path: check.path, content: check.content }, ...(check.support ?? [])], go);
}

/**
 * Each supplied check run at the base, before any edit, as an authored one is: a check that
 * witnesses a requirement must fail there (a check that already passes cannot show the change),
 * a `keep=` check must pass, and a check the runner did not collect or could not parse is refused.
 * Claims must not all hold at the base. The model never sees any of it but its results.
 */
export async function validateSupplied(input: {
  readonly chokepoint: Chokepoint;
  readonly workspace: string;
  readonly conventions: TestConventions | null;
  readonly supplied: readonly Supplied[];
}): Promise<Validated> {
  const checks: UserCheck[] = [];
  const claims: Claim[] = [];
  const refused: string[] = [];
  // A supplied file the runner would not collect is a fixture its tests read, not a check.
  const isTest = (path: string) =>
    input.conventions !== null && testPattern(input.conventions).test(path);
  const support = input.supplied.flatMap((one) =>
    one.kind === "file" && input.conventions !== null && !isTest(one.path)
      ? [{ path: one.path, content: one.content }]
      : [],
  );
  let at = 0;
  for (const one of input.supplied) {
    if (one.kind === "file" && support.some((file) => file.path === one.path)) continue;
    at += 1;
    if (one.kind === "claims") {
      const read = await Promise.all(
        one.claims.map((claim) => structureEvidence(input.workspace, claim)),
      );
      if (read.every((claim) => claim.outcome === "observed"))
        refused.push(
          `${one.source}: every claim already holds at the base, so none can show the change`,
        );
      else claims.push(...one.claims);
      continue;
    }
    const label = one.kind === "file" ? one.path : one.command;
    const named = `${one.requirement ?? "keep"}=${label}`;
    if (one.kind === "file" && input.conventions === null) {
      refused.push(
        `${named}: no test runner was recognized here, so the file cannot run; pass a command with --accept-cmd`,
      );
      continue;
    }
    const check = {
      requirement: one.requirement,
      name: `accept-${one.requirement ?? "keep"}-${at}`,
      command: one.kind === "file" ? (input.conventions?.commandFor(one.path) ?? "") : one.command,
      path: one.kind === "file" ? one.path : null,
      content: one.kind === "file" ? one.content : null,
      ...(one.kind === "file" && support.length > 0 ? { support } : {}),
    };
    const ran = await runUserCheck(
      input.chokepoint,
      input.workspace,
      check,
      "supplied check at the base",
    );
    const plain = plainOutput(ran.output);
    const tail = plain.slice(-600);
    if (ran.decision !== "allowed") refused.push(`${named}: it could not run: ${tail}`);
    else if (notCollected.test(plain))
      refused.push(`${named}: the runner did not collect it: ${tail}`);
    else if (check.path !== null && unparsable.test(plain) && plain.includes(basename(check.path)))
      refused.push(`${named}: it does not parse: ${tail}`);
    else if (one.requirement !== null && ran.exitCode === 0)
      refused.push(
        `${named}: it passes at the base, so it cannot show the change; a check that should keep passing is --accept keep=${label}`,
      );
    else if (one.requirement === null && ran.exitCode !== 0)
      refused.push(
        `${named}: it fails at the base, so it cannot show the change kept behavior: ${tail}`,
      );
    else checks.push({ ...check, atBase: tail });
  }
  return { checks, claims, refused };
}

/**
 * Seals the user's test files outside the candidate's tree as `user-acceptance`, each bound to the
 * requirement it witnesses (none for `keep=`), where the verifier lays them in to run. Commands
 * have no file to seal: they go to the verifier in its request, under the same authority.
 */
export async function sealUserChecks(
  workspace: string,
  home: string,
  checks: readonly UserCheck[],
): Promise<readonly TrustedCheck[]> {
  const files = checks.flatMap((one) =>
    one.path === null || one.content === null
      ? []
      : [{ ...one, path: one.path, content: one.content }],
  );
  if (files.length > 0)
    await sealFiles({
      workspace,
      home,
      authority: "user-acceptance",
      files: [
        ...files.map((one) => ({ path: one.path, content: one.content })),
        ...(files[0]?.support ?? []),
      ],
      checks: files.map((one) => ({
        name: one.name,
        command: one.command,
        kind: "test" as const,
        requirements: one.requirement === null ? [] : [one.requirement],
      })),
    });
  return checks
    .filter((one) => one.path === null)
    .map((one) => ({
      name: one.name,
      command: one.command,
      kind: "other" as const,
      authority: "user-acceptance" as const,
    }));
}
