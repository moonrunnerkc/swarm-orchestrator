import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { hostname, totalmem } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { ProbeResult } from "./probe.ts";

/** The identity a probe result belongs to: change any part and the model is probed again. */
export interface ProbeIdentity {
  readonly runtime: "ollama" | "openai-compatible";
  readonly runtimeVersion: string;
  readonly endpoint: string;
  readonly model: string;
  readonly digest: string;
  readonly quantization: string | null;
  readonly contextTokens: number;
}

const probeSchema = z.object({
  ready: z.boolean(),
  reason: z.string(),
  latencyMs: z.number(),
  tokensPerSecond: z.number().nullable(),
  at: z.string(),
});

const profileSchema = z.object({
  version: z.literal(1),
  /** The namespace this record belongs to: `default` for ordinary runs, or the one named. */
  profile: z.string().optional(),
  machine: z.object({
    hostname: z.string(),
    platform: z.string(),
    arch: z.string(),
    totalMemory: z.number(),
  }),
  probes: z.record(
    z.string(),
    z.object({ identity: z.record(z.string(), z.unknown()), result: probeSchema }),
  ),
  /**
   * Finished tasks by model digest: how often the run ended complete, and the same by the kind of
   * task R1 was (fix, feature, refactor, upgrade, other), which escalation reads.
   */
  outcomes: z.record(
    z.string(),
    z.object({
      complete: z.number().int(),
      other: z.number().int(),
      kinds: z
        .record(z.string(), z.object({ complete: z.number().int(), other: z.number().int() }))
        .optional(),
    }),
  ),
});
export type Profile = z.infer<typeof profileSchema>;

export const identityKey = (identity: ProbeIdentity) =>
  createHash("sha256").update(JSON.stringify(identity)).digest("hex");

/**
 * This machine's profile under the swarm home: one file, keyed by host name, and one more for each
 * named profile (`<host>@<name>.json`), which measured, CI and development runs write instead.
 */
export function profilePath(home: string, name = defaultProfile): string {
  const suffix = name === defaultProfile ? "" : `@${name}`;
  return join(home, "profiles", `${hostname()}${suffix}.json`);
}

export const defaultProfile = "default";
const profileName = /^[A-Za-z0-9][\w.-]{0,63}$/;

export class ProfileNameError extends Error {
  constructor(name: string) {
    super(
      `"${name}" is not a profile name: use letters, digits, dots, dashes and underscores, as in --profile dev`,
    );
    this.name = "ProfileNameError";
  }
}

/** The model record a run reads and writes: which profile, and whether anything is written. */
export interface ModelRecord {
  readonly name: string;
  readonly writes: boolean;
  read(): Promise<Profile>;
  write(profile: Profile): Promise<void>;
}

/**
 * A named profile starts as a copy of the default one, so selection begins where the machine's
 * record stands, and from then on only it is written. `--no-record` reads and writes nothing.
 */
export function modelRecord(
  home: string,
  choice: { readonly profile?: string | undefined; readonly write?: boolean } = {},
): ModelRecord {
  const name = choice.profile ?? defaultProfile;
  if (!profileName.test(name)) throw new ProfileNameError(name);
  const path = profilePath(home, name);
  const writes = choice.write !== false;
  return {
    name,
    writes,
    async read() {
      const own = await access(path).then(
        () => true,
        () => false,
      );
      const profile = await readProfile(own ? path : profilePath(home));
      return { ...profile, profile: name };
    },
    async write(profile) {
      if (writes) await writeProfile(path, { ...profile, profile: name });
    },
  };
}

const empty = (): Profile => ({
  version: 1,
  machine: {
    hostname: hostname(),
    platform: process.platform,
    arch: process.arch,
    totalMemory: totalmem(),
  },
  probes: {},
  outcomes: {},
});

/**
 * The profile, or an empty one where there is none or it belongs to another machine (a home
 * directory shared or copied between machines). A file that does not parse is replaced, never
 * trusted in part.
 */
export async function readProfile(path: string): Promise<Profile> {
  const text = await readFile(path, "utf8").catch(() => null);
  if (text === null) return empty();
  try {
    const parsed = profileSchema.parse(JSON.parse(text));
    const here = empty().machine;
    return parsed.machine.hostname === here.hostname &&
      parsed.machine.totalMemory === here.totalMemory
      ? parsed
      : empty();
  } catch {
    return empty();
  }
}

export async function writeProfile(path: string, profile: Profile): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export function cachedProbe(profile: Profile, identity: ProbeIdentity): ProbeResult | null {
  return profile.probes[identityKey(identity)]?.result ?? null;
}

export function withProbe(profile: Profile, identity: ProbeIdentity, result: ProbeResult): Profile {
  return {
    ...profile,
    probes: { ...profile.probes, [identityKey(identity)]: { identity: { ...identity }, result } },
  };
}

type Tally = { readonly complete: number; readonly other: number };
const tallied = (before: Tally, complete: boolean): Tally =>
  complete ? { ...before, complete: before.complete + 1 } : { ...before, other: before.other + 1 };

export function withOutcome(
  profile: Profile,
  digest: string,
  complete: boolean,
  kind: string | null = null,
): Profile {
  const before = profile.outcomes[digest] ?? { complete: 0, other: 0 };
  const known = before.kinds ?? {};
  const kinds =
    kind === null
      ? known
      : { ...known, [kind]: tallied(known[kind] ?? { complete: 0, other: 0 }, complete) };
  const after = { ...tallied(before, complete), kinds };
  return { ...profile, outcomes: { ...profile.outcomes, [digest]: after } };
}

/** Stops that say nothing about the model: the user, the endpoint or an interruption ended them. */
const notTheModels = new Set(["cancelled", "interrupted", "model-error"]);

/**
 * Whether a run counts toward its model's record, and as complete or not: null where the model
 * did not finish it on its own (an escalation, a stop the model did not cause, or a verification
 * the environment blocked).
 */
export function finishedOutcome(run: {
  readonly stop: string;
  readonly state: string;
  readonly escalated: boolean;
}): boolean | null {
  if (run.escalated || run.state === "blocked" || notTheModels.has(run.stop)) return null;
  return run.state === "complete";
}

/** Adds one finished run to the model's record in this machine's profile. */
export async function recordOutcome(
  record: ModelRecord,
  digest: string,
  complete: boolean,
  kind: string | null = null,
): Promise<void> {
  await record.write(withOutcome(await record.read(), digest, complete, kind));
}
