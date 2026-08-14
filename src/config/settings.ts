import type { SwarmToml } from "./swarm-toml.ts";

/**
 * One resolution, applied at the composition root and injected from there, so nothing below
 * cli.ts ever reads a flag, the environment, or the file (invariant 8).
 *
 * Precedence, highest first:
 *
 * | setting          | CLI flag         | environment                  | swarm.toml                  | default                          |
 * | ---------------- | ---------------- | ---------------------------- | --------------------------- | -------------------------------- |
 * | model            | --model          | SWARM_MODEL                  | [models] pin                | anthropic:claude-opus-5, unpinned |
 * | local endpoint   | --local-endpoint | SWARM_LOCAL_BASE_URL         | [providers] local_endpoint  | none: discovery decides          |
 * | max steps        | --max-steps      |                              | [budgets] max_steps         | 40                               |
 * | attempts         | --attempts      |                              | [budgets] attempts          | 3                                |
 * | anthropic key    |                  | ANTHROPIC_API_KEY            | [providers] anthropic_api_key | unset                          |
 * | openai key       |                  | OPENAI_API_KEY               | [providers] openai_api_key  | unset                            |
 * | google key       |                  | GOOGLE_GENERATIVE_AI_API_KEY | [providers] google_api_key  | unset                            |
 * | gate commands    |                  |                              | [gates] <gate id>           | assembled from the manifests     |
 * | diff budget      |                  |                              | [budgets] max_changed_files, max_added_lines | engine default  |
 *
 * API keys deliberately have no flag: a key on a command line outlives the run in shell
 * history and process listings.
 */

const defaultModelSpec = "anthropic:claude-opus-5";
const defaultMaxSteps = 40;
const defaultAttempts = 3;

/** What the command line contributed: null wherever the caller left a flag unset. */
export interface CommandLineSettings {
  readonly model: string | null;
  readonly maxSteps: number | null;
  readonly attempts: number | null;
  readonly localEndpoint: string | null;
}

export interface ConfiguredLocalEndpoint {
  readonly url: string;
  /** Which layer named it, recorded with the endpoint so a bundle can say how it was chosen. */
  readonly origin: "flag" | "environment" | "config";
}

export interface ResolvedSettings {
  readonly modelSpec: string;
  /** True when some layer named the model. A pinned model is a decision the router leaves alone. */
  readonly modelPinned: boolean;
  readonly maxSteps: number;
  readonly attempts: number;
  readonly providerKeys: {
    readonly anthropic: string | undefined;
    readonly openai: string | undefined;
    readonly google: string | undefined;
  };
  /** Null means no layer named one, and endpoint discovery is what answers that. */
  readonly localEndpoint: ConfiguredLocalEndpoint | null;
  readonly gateCommandOverrides: Readonly<Record<string, string>>;
  /** Only the keys the file set; the engine's defaults fill the rest at the call site. */
  readonly diffBudget: {
    readonly maxChangedFiles?: number;
    readonly maxAddedLines?: number;
  };
}

export interface SettingsInput {
  readonly flags: CommandLineSettings;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly toml: SwarmToml | null;
}

export function resolveSettings(input: SettingsInput): ResolvedSettings {
  const pinnedModel = input.flags.model ?? input.env.SWARM_MODEL ?? input.toml?.models.pin ?? null;

  return {
    modelSpec: pinnedModel ?? defaultModelSpec,
    modelPinned: pinnedModel !== null,
    maxSteps: input.flags.maxSteps ?? input.toml?.budgets.maxSteps ?? defaultMaxSteps,
    attempts: input.flags.attempts ?? input.toml?.budgets.attempts ?? defaultAttempts,
    providerKeys: {
      anthropic: input.env.ANTHROPIC_API_KEY ?? input.toml?.providers.anthropicApiKey ?? undefined,
      openai: input.env.OPENAI_API_KEY ?? input.toml?.providers.openaiApiKey ?? undefined,
      google:
        input.env.GOOGLE_GENERATIVE_AI_API_KEY ?? input.toml?.providers.googleApiKey ?? undefined,
    },
    localEndpoint: resolveLocalEndpoint(input),
    gateCommandOverrides: input.toml?.gates ?? {},
    diffBudget: {
      ...(input.toml?.budgets.maxChangedFiles == null
        ? {}
        : { maxChangedFiles: input.toml.budgets.maxChangedFiles }),
      ...(input.toml?.budgets.maxAddedLines == null
        ? {}
        : { maxAddedLines: input.toml.budgets.maxAddedLines }),
    },
  };
}

function resolveLocalEndpoint(input: SettingsInput): ConfiguredLocalEndpoint | null {
  if (input.flags.localEndpoint !== null) {
    return { url: input.flags.localEndpoint, origin: "flag" };
  }
  const fromEnv = input.env.SWARM_LOCAL_BASE_URL;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return { url: fromEnv, origin: "environment" };
  }
  const fromFile = input.toml?.providers.localEndpoint;
  if (fromFile != null) {
    return { url: fromFile, origin: "config" };
  }
  return null;
}
