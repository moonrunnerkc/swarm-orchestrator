import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";
import type { ProbeResult } from "./probe.ts";
import { type Profile, readProfile, writeProfile } from "./profile-store.ts";

export type { Profile } from "./profile-store.ts";

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

const identityKey = (identity: ProbeIdentity) =>
  createHash("sha256").update(JSON.stringify(identity)).digest("hex");

/**
 * This machine's profile under the swarm home: one file, keyed by host name, and one more for each
 * named profile (`<host>@<name>.json`), which measured, CI and development runs write instead.
 */
export function profilePath(home: string, name = defaultProfile): string {
  const suffix = name === defaultProfile ? "" : `@${name}`;
  return join(home, "profiles", `${hostname()}${suffix}.json`);
}

const defaultProfile = "default";
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
  choice: {
    readonly profile?: string | undefined;
    readonly write?: boolean;
    /** Told when a file is unusable or kept aside; silent where the caller has nowhere to say it. */
    readonly log?: (line: string) => void;
  } = {},
): ModelRecord {
  const name = choice.profile ?? defaultProfile;
  if (!profileName.test(name)) throw new ProfileNameError(name);
  const path = profilePath(home, name);
  const writes = choice.write !== false;
  const log = choice.log ?? (() => {});
  const warned = new Set<string>();
  return {
    name,
    writes,
    async read() {
      const own = await readProfile(path);
      const from = own.standing === "absent" && name !== defaultProfile ? profilePath(home) : path;
      const { standing, profile } = from === path ? own : await readProfile(from);
      if ((standing === "unreadable" || standing === "foreign") && !warned.has(from)) {
        warned.add(from);
        const why =
          standing === "unreadable" ? "could not be read" : "was written on another machine";
        log(
          `the model record at ${from} ${why}: selection starts without it, and the file is kept aside before anything replaces it`,
        );
      }
      return { ...profile, profile: name };
    },
    async write(profile) {
      if (writes) await writeProfile(path, { ...profile, profile: name }, log);
    },
  };
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
