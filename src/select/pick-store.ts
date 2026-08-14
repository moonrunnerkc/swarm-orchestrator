import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

const calibrationPickSchema = z.object({
  /** Null when calibration measured nothing usable, which is itself worth remembering. */
  model: z.string().min(1).nullable(),
  /** Every model that run compared, which is the arm set the router explores. */
  candidates: z.array(z.string().min(1)).min(1),
  goldenSetVersion: z.string().min(1),
  recordedAt: z.number().int(),
});

type CalibrationPickRecord = z.infer<typeof calibrationPickSchema>;

/** Beside the routing log it feeds, outside every workspace. */
export function defaultPickPath(homeDirectory: string): string {
  return join(homeDirectory, ".swarm", "routing", "calibration-pick.json");
}

/**
 * What the last calibration decided, so a later run has something to route from. Overwritten
 * rather than appended: only the latest measurement of this machine is the one to route on,
 * and the runs behind every past pick are in their own evidence bundles.
 */
export async function writeCalibrationPick(
  path: string,
  record: CalibrationPickRecord,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(calibrationPickSchema.parse(record), null, 2)}\n`,
    "utf8",
  );
}

/**
 * Null for absent and null for damaged alike. This is a routing hint, not evidence: a file
 * that cannot be read costs the bandit its starting point, and the run carries on with the
 * model it was given.
 */
export async function readCalibrationPick(path: string): Promise<CalibrationPickRecord | null> {
  try {
    const parsed = calibrationPickSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
