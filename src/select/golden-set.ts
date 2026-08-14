import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { digestOfJson, type JsonValue } from "../evidence/canonical-json.ts";
import {
  type CalibrationCase,
  calibrationCaseSchema,
  caseDigest,
  parseCalibrationCase,
} from "./calibration-case.ts";

export const goldenSetSchemaVersion = 1;

const bundledSetSchema = z.object({
  schemaVersion: z.literal(goldenSetSchemaVersion),
  revision: z.string().min(1),
  cases: z.array(calibrationCaseSchema).min(1),
});

export interface GoldenSet {
  /** Bundled cases first, then captured ones in the order they were captured. */
  readonly cases: readonly CalibrationCase[];
  /** Digest over the ordered case digests: what a calibration report cites as what it ran. */
  readonly version: string;
  readonly bundledCount: number;
  readonly capturedCount: number;
  readonly localPath: string;
}

export interface GoldenSetOptions {
  readonly localPath: string;
}

/** Beside the session store, outside every workspace (invariant 11). */
export function defaultGoldenSetPath(homeDirectory: string): string {
  return join(homeDirectory, ".swarm", "calibration", "cases.jsonl");
}

export class DuplicateCalibrationCaseError extends Error {
  constructor(id: string) {
    super(
      `the golden set already carries a case with id "${id}". The set only grows: a case is ` +
        "never replaced, because a model that regressed on it must keep failing it. Capture " +
        "the new one under a different id.",
    );
    this.name = "DuplicateCalibrationCaseError";
  }
}

/**
 * The set that calibration measures against: what shipped, plus everything captured since.
 * Append-only, so a failure that was once observed can never quietly stop being measured.
 */
export async function readGoldenSet(options: GoldenSetOptions): Promise<GoldenSet> {
  const bundled = await readBundledCases();
  const captured = await readCapturedCases(options.localPath);
  const cases = [...bundled, ...captured];

  return {
    cases,
    version: goldenSetVersion(cases),
    bundledCount: bundled.length,
    capturedCount: captured.length,
    localPath: options.localPath,
  };
}

export async function appendCalibrationCase(
  options: GoldenSetOptions,
  one: CalibrationCase,
): Promise<GoldenSet> {
  const existing = await readGoldenSet(options);
  if (existing.cases.some((candidate) => candidate.id === one.id)) {
    throw new DuplicateCalibrationCaseError(one.id);
  }

  await mkdir(dirname(options.localPath), { recursive: true });
  await appendFile(options.localPath, `${JSON.stringify(one)}\n`, "utf8");
  return readGoldenSet(options);
}

/**
 * Over the ordered digests rather than the set as a whole, so the version says which cases in
 * which order: appending changes it, and so does any edit to a case that was already there.
 */
export function goldenSetVersion(cases: readonly CalibrationCase[]): string {
  return digestOfJson(cases.map((one) => caseDigest(one)) as unknown as JsonValue);
}

async function readBundledCases(): Promise<readonly CalibrationCase[]> {
  const text = await readFile(new URL("./calibration-cases.v1.json", import.meta.url), "utf8");
  const parsed = bundledSetSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(
      `the golden set that ships with this release is not usable:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data.cases;
}

/**
 * A malformed captured line is fatal, unlike a malformed routing line. Calibration measures
 * against this set, so silently measuring against less of it would quietly weaken the very
 * thing that is meant to stop regressions going unnoticed.
 */
async function readCapturedCases(path: string): Promise<readonly CalibrationCase[]> {
  const text = await readFile(path, "utf8").catch(() => "");
  const cases: CalibrationCase[] = [];

  text.split("\n").forEach((line, index) => {
    if (line.trim().length === 0) {
      return;
    }
    cases.push(parseCalibrationCase(parseJson(line, path, index + 1), `${path} line ${index + 1}`));
  });
  return cases;
}

function parseJson(line: string, path: string, lineNumber: number): unknown {
  try {
    return JSON.parse(line);
  } catch (cause) {
    throw new Error(
      `${path} line ${lineNumber} is not JSON (${cause instanceof Error ? cause.message : String(cause)}). ` +
        "The captured calibration set is append-only; repair the line rather than deleting it.",
    );
  }
}
