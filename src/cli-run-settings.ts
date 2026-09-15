import { readFile } from "node:fs/promises";
import {
  type CommandLineSettings,
  type ResolvedSettings,
  resolveSettings,
} from "./config/settings.ts";
import { readSwarmToml } from "./config/swarm-toml.ts";
import type { GateSetOptions } from "./gates/default-gates.ts";
import { defaultDiffBudget } from "./gates/engine.ts";
import type { DiffBudget } from "./gates/gate-definition.ts";
import type { ResolvedLocalEndpoint } from "./providers/endpoint-resolution.ts";
import type { TransportTraceSink } from "./providers/transport-trace.ts";
import { createFileTraceSink } from "./providers/transport-trace-file.ts";
export const noFlagSettings: CommandLineSettings = {
  model: null,
  maxSteps: null,
  attempts: null,
  maxWallMinutes: null,
  localEndpoint: null,
};

/**
 * Config is read once, here at the composition root, and injected downward: nothing below
 * cli.ts sees the file or the environment. Precedence lives in src/config/settings.ts.
 */
export async function settingsFor(
  directory: string,
  flags: CommandLineSettings,
): Promise<ResolvedSettings> {
  const found = await readSwarmToml({ directory, readFile: (path) => readFile(path, "utf8") });
  return resolveSettings({ flags, env: process.env, toml: found?.toml ?? null });
}

export function gateOptionsFrom(settings: ResolvedSettings): GateSetOptions | undefined {
  return Object.keys(settings.gateCommandOverrides).length === 0
    ? undefined
    : { commandOverrides: settings.gateCommandOverrides };
}

export function diffBudgetFrom(settings: ResolvedSettings): DiffBudget | undefined {
  return Object.keys(settings.diffBudget).length === 0
    ? undefined
    : { ...defaultDiffBudget, ...settings.diffBudget };
}

export function registrySettingsFrom(
  settings: ResolvedSettings,
  localBackend: ResolvedLocalEndpoint | null,
): {
  anthropicApiKey: string | undefined;
  openaiApiKey: string | undefined;
  googleApiKey: string | undefined;
  localBaseUrl: string | undefined;
  localThinking: boolean | null;
  transportTrace: TransportTraceSink | undefined;
} {
  return {
    anthropicApiKey: settings.providerKeys.anthropic,
    openaiApiKey: settings.providerKeys.openai,
    googleApiKey: settings.providerKeys.google,
    localBaseUrl: localBackend?.url,
    localThinking: settings.localThinking,
    // Built here rather than in the registry, so the one module that talks to a network still
    // does no file IO of its own. Nothing is opened until a call is actually traced.
    transportTrace:
      settings.transportTracePath === null
        ? undefined
        : createFileTraceSink(settings.transportTracePath),
  };
}
