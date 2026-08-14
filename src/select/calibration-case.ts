import { isAbsolute, normalize } from "node:path";
import { z } from "zod";
import { digestOfJson, type JsonValue } from "../evidence/canonical-json.ts";
import { taskClasses } from "./task-class.ts";

/**
 * A seed path is written into a scratch directory, so it may not climb out of one. Checked at
 * load rather than at write, because a case that could escape should never enter a permanent
 * set at all.
 */
function escapesWorkspace(path: string): boolean {
  const normalized = normalize(path);
  return isAbsolute(normalized) || normalized.startsWith("..") || normalized.includes("\0");
}

const seedSchema = z.record(z.string(), z.string()).superRefine((seed, context) => {
  const paths = Object.keys(seed);
  if (paths.length === 0) {
    context.addIssue({
      code: "custom",
      message: "a case seeds at least one file, or the model has nothing to work on",
    });
  }
  for (const path of paths) {
    if (escapesWorkspace(path)) {
      context.addIssue({
        code: "custom",
        path: [path],
        message: `"${path}" would land outside the scratch workspace, which a case may not do`,
      });
    }
  }
});

export const calibrationCaseSchema = z.object({
  id: z.string().min(1),
  taskClass: z.enum(taskClasses),
  prompt: z.string().min(1),
  /** The scratch workspace this case starts from: relative path to file contents. */
  seed: seedSchema,
  /** The command whose exit code decides whether the case was solved. */
  gateCommand: z.string().min(1),
  /** Shipped with the release, or captured from a real task that failed. */
  origin: z.enum(["bundled", "captured"]),
  addedAt: z.string().min(1),
});

export type CalibrationCase = z.infer<typeof calibrationCaseSchema>;

export class MalformedCalibrationCaseError extends Error {
  constructor(source: string, problem: string) {
    super(
      `the calibration case from ${source} is not usable:\n${problem}\n` +
        "A case names an id, a task class, a prompt, the files it starts from, and the command " +
        "that decides whether it was solved.",
    );
    this.name = "MalformedCalibrationCaseError";
  }
}

export function parseCalibrationCase(value: unknown, source: string): CalibrationCase {
  const parsed = calibrationCaseSchema.safeParse(value);
  if (!parsed.success) {
    throw new MalformedCalibrationCaseError(source, z.prettifyError(parsed.error));
  }
  return parsed.data;
}

/**
 * A case's name in the evidence bundle. Content-addressed like everything else, so the report
 * cites the case it actually ran rather than an id someone could later point elsewhere.
 */
export function caseDigest(one: CalibrationCase): string {
  return digestOfJson(one as unknown as JsonValue);
}
