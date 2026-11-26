import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { hostname, totalmem } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const count = z.number().int();
const machineSchema = z.object({
  hostname: z.string(),
  platform: z.string(),
  arch: z.string(),
  totalMemory: z.number(),
});
const probeSchema = z.object({
  ready: z.boolean(),
  reason: z.string(),
  latencyMs: z.number(),
  tokensPerSecond: z.number().nullable(),
  at: z.string(),
});
const shared = {
  /** The namespace this record belongs to: `default` for ordinary runs, or the one named. */
  profile: z.string().optional(),
  machine: machineSchema,
  probes: z.record(
    z.string(),
    z.object({ identity: z.record(z.string(), z.unknown()), result: probeSchema }),
  ),
};

/** Version 1 counted every run that did not end complete against its model, whatever ended it. */
const v1Schema = z.object({
  version: z.literal(1),
  ...shared,
  outcomes: z.record(
    z.string(),
    z.object({
      complete: count,
      other: count,
      kinds: z.record(z.string(), z.object({ complete: count, other: count })).optional(),
    }),
  ),
});

/**
 * Finished tasks by model digest. `complete` and `other` are the model's record and the only
 * counts selection ranks by: `other` is the runs the model stopped short on its own, together
 * with `legacyOther`, the version 1 entries carried forward, which cannot be told apart from
 * runs the environment ended. `unattributed` runs measure nothing about the model and are kept
 * for diagnosis alone. `kinds` is the same by the kind of task R1 was, which escalation reads.
 */
const profileSchema = z.object({
  version: z.literal(2),
  ...shared,
  outcomes: z.record(
    z.string(),
    z.object({
      complete: count,
      other: count,
      legacyOther: count.optional(),
      unattributed: count.optional(),
      kinds: z
        .record(
          z.string(),
          z.object({ complete: count, other: count, unattributed: count.optional() }),
        )
        .optional(),
    }),
  ),
});
export type Profile = z.infer<typeof profileSchema>;

const emptyProfile = (): Profile => ({
  version: 2,
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
 * Version 1 counts carried forward as they stand. They cannot be attributed after the fact, so
 * none is relabelled or dropped: each digest's `other` is marked as predating attribution.
 */
function migrated(old: z.infer<typeof v1Schema>): Profile {
  const outcomes: Profile["outcomes"] = {};
  for (const [digest, tally] of Object.entries(old.outcomes)) {
    outcomes[digest] = {
      complete: tally.complete,
      other: tally.other,
      legacyOther: tally.other,
      unattributed: 0,
      ...(tally.kinds === undefined ? {} : { kinds: tally.kinds }),
    };
  }
  return { ...old, version: 2, outcomes };
}

/**
 * What stands at a profile's path: nothing, this machine's record (`v1` where it is still in the
 * old format), another machine's (a home directory shared or copied between machines), or bytes
 * that are not a profile at all.
 */
type Standing = "absent" | "current" | "v1" | "foreign" | "unreadable";

function parsed(text: string): { readonly standing: Standing; readonly profile: Profile } {
  let found: { standing: "current" | "v1"; profile: Profile };
  try {
    const json: unknown = JSON.parse(text);
    const current = profileSchema.safeParse(json);
    found = current.success
      ? { standing: "current", profile: current.data }
      : { standing: "v1", profile: migrated(v1Schema.parse(json)) };
  } catch {
    return { standing: "unreadable", profile: emptyProfile() };
  }
  const here = emptyProfile().machine;
  const mine =
    found.profile.machine.hostname === here.hostname &&
    found.profile.machine.totalMemory === here.totalMemory;
  return mine ? found : { standing: "foreign", profile: emptyProfile() };
}

/**
 * The profile at a path, upgraded in memory where it is version 1. Another machine's record and
 * a file that does not parse both read as empty and are never trusted in part, but neither is
 * lost: `writeProfile` keeps the bytes aside before it replaces them.
 */
export async function readProfile(
  path: string,
): Promise<{ readonly standing: Standing; readonly profile: Profile }> {
  const text = await readFile(path, "utf8").catch(() => null);
  return text === null ? { standing: "absent", profile: emptyProfile() } : parsed(text);
}

const exists = (error: unknown) =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === "EEXIST";

/** Writes bytes at the first free name of `<stem>.json`, `<stem>-1.json`, ...; never over a file. */
async function keptAt(stem: string, bytes: Buffer): Promise<string> {
  for (let at = 0; ; at += 1) {
    const path = `${stem}${at === 0 ? "" : `-${at}`}.json`;
    try {
      await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
      return path;
    } catch (error) {
      if (!exists(error)) throw error;
    }
  }
}

/**
 * Keeps aside the file a write is about to replace, where the new profile does not carry it
 * whole: a version 1 file as `<name>.v1.json`, once (an existing backup is never overwritten; a
 * different version 1 file met later is kept under a dated name beside it), another machine's
 * record and an unreadable file under dated names. Returns what to tell the user, or null.
 */
async function keepAside(path: string): Promise<string | null> {
  const bytes = await readFile(path).catch(() => null);
  if (bytes === null) return null;
  const { standing } = parsed(bytes.toString("utf8"));
  if (standing === "current" || standing === "absent") return null;
  const stem = path.replace(/\.json$/, "");
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  if (standing === "v1") {
    const backup = `${stem}.v1.json`;
    const held = await readFile(backup).catch(() => null);
    if (held?.equals(bytes) === true) return null;
    const kept = held === null ? await keptAt(`${stem}.v1`, bytes) : null;
    return `the model record at ${path} was version 1: its counts are carried forward, and the file as it was is kept at ${kept ?? (await keptAt(`${stem}.v1-${stamp}`, bytes))}`;
  }
  if (standing === "foreign") {
    const kept = await keptAt(`${stem}.other-machine-${stamp}`, bytes);
    return `the model record at ${path} was written on another machine and is not used here: kept at ${kept}`;
  }
  const kept = await keptAt(`${stem}.unreadable-${stamp}`, bytes);
  return `the model record at ${path} could not be read and is replaced: its bytes are kept at ${kept}`;
}

/** Replaces the profile at a path, after keeping aside whatever the new one does not carry. */
export async function writeProfile(
  path: string,
  profile: Profile,
  log: (line: string) => void,
): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  const aside = await keepAside(path);
  if (aside !== null) log(aside);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
