import { swarmHome } from "./agent/verification.ts";
import { UsageError } from "./cli-command-definitions.ts";
import { type ModelRecord, modelRecord, ProfileNameError } from "./runtime/profile.ts";

/**
 * The model record this run reads and writes: `--profile`, else SWARM_PROFILE, else the machine's
 * default, which only ordinary runs should write. Measured, CI and development runs name another.
 */
export function recordFor(profile: string | undefined, readOnly: boolean): ModelRecord {
  try {
    return modelRecord(swarmHome(), {
      profile: profile ?? process.env.SWARM_PROFILE,
      write: !readOnly,
    });
  } catch (error) {
    if (error instanceof ProfileNameError) throw new UsageError(error.message);
    throw error;
  }
}
