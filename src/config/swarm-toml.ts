import { join } from "node:path";
import { parse as parseToml, TomlError } from "smol-toml";
import { z } from "zod";

/**
 * The one optional configuration file (build guide 4.2): provider keys and endpoints, gate
 * overrides, budgets, and model pins. Nothing else belongs here; a new setting that does not
 * fit one of those four tables is a design question, not a schema addition.
 */

export const swarmTomlFileName = "swarm.toml";

const nonEmptyString = z.string().min(1);
const positiveWholeNumber = z.number().int().positive();
const httpUrl = z.url({ protocol: /^https?$/ });

const rawFileSchema = z.strictObject({
  providers: z
    .strictObject({
      anthropic_api_key: nonEmptyString.optional(),
      openai_api_key: nonEmptyString.optional(),
      google_api_key: nonEmptyString.optional(),
      local_endpoint: httpUrl.optional(),
    })
    .optional(),
  gates: z.record(nonEmptyString, nonEmptyString).optional(),
  budgets: z
    .strictObject({
      max_steps: positiveWholeNumber.optional(),
      attempts: positiveWholeNumber.optional(),
      max_changed_files: positiveWholeNumber.optional(),
      max_added_lines: positiveWholeNumber.optional(),
    })
    .optional(),
  models: z
    .strictObject({
      pin: nonEmptyString.optional(),
    })
    .optional(),
});

export interface SwarmToml {
  readonly providers: {
    readonly anthropicApiKey: string | null;
    readonly openaiApiKey: string | null;
    readonly googleApiKey: string | null;
    readonly localEndpoint: string | null;
  };
  /** Command overrides by gate id, handed to the gate assembler verbatim. */
  readonly gates: Readonly<Record<string, string>>;
  readonly budgets: {
    readonly maxSteps: number | null;
    readonly attempts: number | null;
    readonly maxChangedFiles: number | null;
    readonly maxAddedLines: number | null;
  };
  readonly models: {
    readonly pin: string | null;
  };
}

export class MalformedSwarmTomlError extends Error {
  readonly source: string;

  constructor(source: string, problem: string) {
    super(`${source} is not usable: ${problem}`);
    this.name = "MalformedSwarmTomlError";
    this.source = source;
  }
}

const acceptedTables = "providers, gates, budgets, models";

const acceptedKeysByTable: Readonly<Record<string, string>> = {
  providers: "anthropic_api_key, openai_api_key, google_api_key, local_endpoint",
  budgets: "max_steps, attempts, max_changed_files, max_added_lines",
  models: "pin",
};

/** What each value must look like, said in the error rather than left to a schema dump. */
const acceptedValueByKey: Readonly<Record<string, string>> = {
  "providers.anthropic_api_key": "a non-empty string",
  "providers.openai_api_key": "a non-empty string",
  "providers.google_api_key": "a non-empty string",
  "providers.local_endpoint": 'an http(s) URL such as "http://127.0.0.1:11434/v1"',
  "budgets.max_steps": "a positive whole number",
  "budgets.attempts": "a positive whole number",
  "budgets.max_changed_files": "a positive whole number",
  "budgets.max_added_lines": "a positive whole number",
  "models.pin": 'a model spec such as "anthropic:claude-opus-5"',
};

export function parseSwarmToml(text: string, source: string): SwarmToml {
  let value: unknown;
  try {
    value = parseToml(text);
  } catch (error) {
    const detail =
      error instanceof TomlError
        ? `its TOML syntax is broken at line ${error.line}: ${error.message.split("\n")[0]}`
        : `its TOML syntax is broken (${error instanceof Error ? error.message : String(error)})`;
    throw new MalformedSwarmTomlError(source, detail);
  }

  const parsed = rawFileSchema.safeParse(value);
  if (!parsed.success) {
    throw new MalformedSwarmTomlError(source, describeIssues(parsed.error, value));
  }

  const raw = parsed.data;
  return {
    providers: {
      anthropicApiKey: raw.providers?.anthropic_api_key ?? null,
      openaiApiKey: raw.providers?.openai_api_key ?? null,
      googleApiKey: raw.providers?.google_api_key ?? null,
      localEndpoint: raw.providers?.local_endpoint ?? null,
    },
    gates: raw.gates ?? {},
    budgets: {
      maxSteps: raw.budgets?.max_steps ?? null,
      attempts: raw.budgets?.attempts ?? null,
      maxChangedFiles: raw.budgets?.max_changed_files ?? null,
      maxAddedLines: raw.budgets?.max_added_lines ?? null,
    },
    models: {
      pin: raw.models?.pin ?? null,
    },
  };
}

/**
 * Every issue names the key it is about, what was found there, and what would have been
 * accepted, because "invalid input" against a config file is a message to a person mid-edit.
 */
function describeIssues(error: z.ZodError, value: unknown): string {
  const lines = error.issues.map((issue) => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => describeUnknownKey(issue.path, key)).join("\n");
    }
    return describeBadValue(issue, value);
  });
  return lines.join("\n");
}

function describeUnknownKey(path: readonly PropertyKey[], key: string): string {
  if (path.length === 0) {
    return `"${key}" is not a table this build reads. Accepted tables: ${acceptedTables}.`;
  }
  const table = path.map(String).join(".");
  const accepted = acceptedKeysByTable[table];
  return (
    `[${table}] ${key} is not a key this build reads.` +
    (accepted === undefined ? "" : ` Accepted keys: ${accepted}.`)
  );
}

function describeBadValue(issue: z.core.$ZodIssue, value: unknown): string {
  const path = issue.path.map(String);
  const label = path.length > 1 ? `[${path.slice(0, -1).join(".")}] ${path.at(-1)}` : path.join("");
  const accepted =
    acceptedValueByKey[path.join(".")] ??
    (path[0] === "gates" ? "a command string" : issue.message);
  return `${label}: expected ${accepted}, found ${JSON.stringify(valueAt(value, path))}`;
}

function valueAt(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const step of path) {
    if (current === null || typeof current !== "object") {
      return current;
    }
    current = (current as Record<string, unknown>)[step];
  }
  return current;
}

export interface SwarmTomlReader {
  /** The workspace root, which is the one place the file is looked for. */
  readonly directory: string;
  readonly readFile: (path: string) => Promise<string>;
}

export interface FoundSwarmToml {
  readonly toml: SwarmToml;
  readonly path: string;
}

/**
 * Null when the file does not exist: that is the zero-config default, not a failure. A file
 * that exists but does not validate raises, because running on silent defaults against an
 * edited config would honour none of what the edit asked for.
 */
export async function readSwarmToml(reader: SwarmTomlReader): Promise<FoundSwarmToml | null> {
  const path = join(reader.directory, swarmTomlFileName);
  let text: string;
  try {
    text = await reader.readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return { toml: parseSwarmToml(text, path), path };
}
