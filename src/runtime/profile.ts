import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
  /** Finished tasks by model digest: how often the run ended complete. */
  outcomes: z.record(z.string(), z.object({ complete: z.number().int(), other: z.number().int() })),
});
export type Profile = z.infer<typeof profileSchema>;

export const identityKey = (identity: ProbeIdentity) =>
  createHash("sha256").update(JSON.stringify(identity)).digest("hex");

/** This machine's profile under the swarm home: one file, keyed by host name. */
export function profilePath(home: string): string {
  return join(home, "profiles", `${hostname()}.json`);
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

export function withOutcome(profile: Profile, digest: string, complete: boolean): Profile {
  const before = profile.outcomes[digest] ?? { complete: 0, other: 0 };
  const after = complete
    ? { ...before, complete: before.complete + 1 }
    : { ...before, other: before.other + 1 };
  return { ...profile, outcomes: { ...profile.outcomes, [digest]: after } };
}
