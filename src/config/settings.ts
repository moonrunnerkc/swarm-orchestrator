import type { InterfaceFlags } from "../cli-options.ts";
import type { GateOverride } from "../gates/gate-definition.ts";
import type { OpenEvidencePolicy } from "../tui/session-interface.ts";
import type { ColorMode } from "../tui/theme.ts";
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
 * | max wall minutes | --max-wall-minutes |                           | [budgets] max_wall_minutes  | none: each loop has its own half hour |
 * | anthropic key    |                  | ANTHROPIC_API_KEY            | [providers] anthropic_api_key | unset                          |
 * | openai key       |                  | OPENAI_API_KEY               | [providers] openai_api_key  | unset                            |
 * | google key       |                  | GOOGLE_GENERATIVE_AI_API_KEY | [providers] google_api_key  | unset                            |
 * | gate commands    |                  |                              | [gates] <gate id>           | assembled from the manifests     |
 * | diff budget      |                  |                              | [budgets] max_changed_files, max_added_lines | engine default  |
 * | interactive view | --no-tui         |                              | [interface] tui             | on, wherever there is a terminal |
 * | colour           | --color/--no-color | NO_COLOR and TERM, under "auto" | [interface] color        | auto                             |
 * | open evidence    | --open-evidence/--no-open-evidence |            | [interface] open_evidence   | ask, and never off a terminal    |
 * | confirm timeout  |                  |                              | [interface] confirm_timeout_minutes | 30 minutes, then refused |
 * | local thinking   |                  |                              | [providers] local_thinking  | unset: the server's own default  |
 * | transport trace  |                  | SWARM_TRANSPORT_TRACE        |                             | off: nothing is written          |
 * | colours by slot  |                  |                              | [theme] <slot>              | the one shipped theme            |
 * | keys by action   |                  |                              | [keys] <action>             | the default keymap               |
 *
 * Colour under "auto" is the one setting the environment gets a say in, because NO_COLOR is
 * a convention a user sets once for every tool rather than for this one.
 *
 * API keys deliberately have no flag: a key on a command line outlives the run in shell
 * history and process listings.
 */

const defaultModelSpec = "anthropic:claude-opus-5";
const defaultMaxSteps = 40;
const defaultAttempts = 3;
/**
 * How long a confirmation waits before it refuses itself. A run held on a question nobody is
 * there to answer used to wait for ever: one sat overnight and had done nothing by morning.
 * Refusing is what the chokepoint records either way, so timing out costs a tool call rather
 * than the run, and half an hour is longer than anyone watching a run steps away for.
 */
const defaultConfirmTimeoutMinutes = 30;

/** What the command line contributed: null wherever the caller left a flag unset. */
export interface CommandLineSettings {
  readonly model: string | null;
  readonly maxSteps: number | null;
  readonly attempts: number | null;
  /** The whole run's wall budget, the first loop and every resolve attempt together. */
  readonly maxWallMinutes?: number | null;
  readonly localEndpoint: string | null;
  readonly interfaceFlags?: InterfaceFlags;
}

/** Everything about the screen, resolved once. `auto` is decided against the real terminal. */
export interface ResolvedInterface {
  readonly tui: boolean;
  readonly color: ColorMode;
  readonly openEvidence: OpenEvidencePolicy;
  /** Milliseconds a confirmation waits for an answer before refusing it. 0 waits for ever. */
  readonly confirmTimeoutMs: number;
  readonly theme: Readonly<Record<string, string>>;
  readonly keys: Readonly<Record<string, string>>;
}

interface ConfiguredLocalEndpoint {
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
  /** Null is no budget over the run as a whole; each loop still has its own half hour. */
  readonly maxWallMinutes: number | null;
  readonly providerKeys: {
    readonly anthropic: string | undefined;
    readonly openai: string | undefined;
    readonly google: string | undefined;
  };
  /** Null means no layer named one, and endpoint discovery is what answers that. */
  readonly localEndpoint: ConfiguredLocalEndpoint | null;
  /** Null leaves the local server's own default alone, which is what sending nothing does. */
  readonly localThinking: boolean | null;
  /**
   * Where raw local-backend request and response bodies are written, or null for the default,
   * which writes nothing. Environment only and no swarm.toml key: this is a thing an operator
   * turns on for one run while diagnosing, not a thing a project configures for everyone.
   */
  readonly transportTracePath: string | null;
  readonly gateCommandOverrides: Readonly<Record<string, GateOverride>>;
  /** Only the keys the file set; the engine's defaults fill the rest at the call site. */
  readonly diffBudget: {
    readonly maxChangedFiles?: number;
    readonly maxAddedLines?: number;
  };
  readonly interface: ResolvedInterface;
}

interface SettingsInput {
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
    maxWallMinutes: input.flags.maxWallMinutes ?? input.toml?.budgets.maxWallMinutes ?? null,
    providerKeys: {
      anthropic: input.env.ANTHROPIC_API_KEY ?? input.toml?.providers.anthropicApiKey ?? undefined,
      openai: input.env.OPENAI_API_KEY ?? input.toml?.providers.openaiApiKey ?? undefined,
      google:
        input.env.GOOGLE_GENERATIVE_AI_API_KEY ?? input.toml?.providers.googleApiKey ?? undefined,
    },
    localEndpoint: resolveLocalEndpoint(input),
    localThinking: input.toml?.providers.localThinking ?? null,
    transportTracePath: emptyToNull(input.env.SWARM_TRANSPORT_TRACE),
    gateCommandOverrides: input.toml?.gates ?? {},
    interface: resolveInterface(input),
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

/** An environment variable set to nothing is a variable nobody set. */
function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value.length === 0 ? null : value;
}

function resolveInterface(input: SettingsInput): ResolvedInterface {
  const flags = input.flags.interfaceFlags;
  return {
    tui: flags?.tui ?? input.toml?.interface.tui ?? true,
    color: flags?.color ?? input.toml?.interface.color ?? "auto",
    openEvidence: flags?.openEvidence ?? input.toml?.interface.openEvidence ?? "ask",
    confirmTimeoutMs:
      (input.toml?.interface.confirmTimeoutMinutes ?? defaultConfirmTimeoutMinutes) * 60_000,
    theme: input.toml?.theme ?? {},
    keys: input.toml?.keys ?? {},
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
