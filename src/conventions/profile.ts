import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  type ConventionRule,
  type ConventionSet,
  conventionRules,
  conventionSetSchema,
} from "swarm-verify";
import { z } from "zod";

/** A new incompatible shape gets a new version; a file of another version is refused, not guessed at. */
export const profileVersion = "swarm.conventions/v1";

export const profileSchema = z.strictObject({
  version: z.literal(profileVersion),
  /** The measurable preferences: each is checked on the files a run changes. */
  rules: conventionSetSchema.default({}),
  /** Preferences nothing measures, such as how much to comment: the model reads them, nothing checks them. */
  guidance: z.array(z.string().min(1).max(300)).max(20).default([]),
  /** What the rules were learned from: paths and digests, never the text. */
  sources: z.array(z.strictObject({ path: z.string().min(1), sha256: z.string() })).default([]),
  approvedAt: z.string().optional(),
});
export type ConventionProfile = z.output<typeof profileSchema>;

export class ConventionProfileError extends Error {
  constructor(path: string, detail: string) {
    super(
      `the conventions profile ${path} cannot be used: ${detail}. Correct it, or remove it and approve a proposal again (swarm init --learn)`,
    );
    this.name = "ConventionProfileError";
  }
}

/**
 * Where an approved profile lives: under SWARM_HOME, which no run's commands can write. One for
 * the machine, and one for each repository, named for its directory and a digest of its path.
 */
export function profilePath(home: string, repository: string | null): string {
  if (repository === null) return join(home, "conventions", "global.json");
  const digest = createHash("sha256").update(repository).digest("hex").slice(0, 12);
  return join(home, "conventions", "projects", `${basename(repository)}-${digest}.json`);
}

/** The profile at `path`, null where there is none. One that does not validate is an error. */
export async function readProfile(path: string): Promise<ConventionProfile | null> {
  const text = await readFile(path, "utf8").catch(() => null);
  if (text === null) return null;
  try {
    return profileSchema.parse(JSON.parse(text));
  } catch (error) {
    const issue = error instanceof z.ZodError ? error.issues[0] : undefined;
    throw new ConventionProfileError(
      path,
      issue === undefined
        ? "it is not JSON"
        : `${issue.path.join(".") || "profile"} ${issue.message}`,
    );
  }
}

/** Written whole or not at all, owner-only. A profile left with nothing in it is removed. */
export async function writeProfile(path: string, profile: ConventionProfile): Promise<void> {
  if (Object.keys(profile.rules).length === 0 && profile.guidance.length === 0) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const partial = `${path}.${randomBytes(6).toString("hex")}.partial`;
  await writeFile(partial, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  await rename(partial, path);
}

/** The conventions one run works under, as they were when it started. */
export interface EffectiveConventions {
  readonly version: string;
  readonly rules: ConventionSet;
  readonly guidance: readonly string[];
  /** Which profile each rule came from. */
  readonly origin: Readonly<Partial<Record<ConventionRule, "project" | "global">>>;
  /** Where the two profiles disagree, and which applies. */
  readonly conflicts: readonly string[];
  /** A digest of the rules and guidance, bound into the run's evidence. */
  readonly sha256: string;
}

/**
 * The approved conventions for a repository: the machine's defaults with the project's own laid
 * over them, rule by rule. A disagreement is resolved for the project and said, never silently.
 * Null where nothing is approved.
 */
export async function effectiveConventions(
  home: string,
  repository: string,
): Promise<EffectiveConventions | null> {
  const global = await readProfile(profilePath(home, null));
  const project = await readProfile(profilePath(home, repository));
  if (global === null && project === null) return null;
  const rules: Record<string, string> = {};
  const origin: Partial<Record<ConventionRule, "project" | "global">> = {};
  const conflicts: string[] = [];
  for (const rule of conventionRules) {
    const [own, shared] = [project?.rules[rule], global?.rules[rule]];
    const value = own ?? shared;
    if (value === undefined) continue;
    rules[rule] = value;
    origin[rule] = own === undefined ? "global" : "project";
    if (own !== undefined && shared !== undefined && own !== shared)
      conflicts.push(
        `${rule}: this project's profile says ${own} and the global profile says ${shared}; the project's applies`,
      );
  }
  const guidance = [...new Set([...(global?.guidance ?? []), ...(project?.guidance ?? [])])];
  const parsed = conventionSetSchema.parse(rules);
  return {
    version: profileVersion,
    rules: parsed,
    guidance,
    origin,
    conflicts,
    sha256: createHash("sha256")
      .update(JSON.stringify({ rules: parsed, guidance }))
      .digest("hex"),
  };
}
