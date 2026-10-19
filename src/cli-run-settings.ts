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

/**
 * The share of a run's total allowance held for its final verification, so planning,
 * implementation and repair cannot spend it: the gate cycle on the delivered tree, the acceptance
 * gate and the final independent verification in a fresh checkout. C1 spent its whole wall in the
 * worker loop and its final build, lint and tests were refused.
 *
 * Measured where it can be: the preflight of a goal run prepares a fresh checkout and runs the
 * sealed checks at the base, which is what the acceptance gate and the final verification each do
 * again, and the gate cycle is of the same order; so four times that measurement. Where nothing was
 * measured, a minute. Never more than a quarter of the total, so a short run keeps three quarters
 * for its work. A reserve is an allowance, not a promise: checks slower than it are stopped at the
 * end of the total and reported as not run.
 */
export function verificationReserve(
  totalMs: number,
  measuredMs: number | null,
): {
  readonly reserveMs: number;
  readonly basis: "measured" | "policy-floor" | "cap";
  readonly measuredMs: number | null;
  readonly capMs: number;
} {
  const capMs = Math.floor(totalMs * reserveMaxShare);
  const wanted =
    measuredMs === null
      ? reserveFloorMs
      : Math.max(reserveFloorMs, measuredMs * reservePerMeasured);
  const basis =
    wanted > capMs
      ? "cap"
      : measuredMs !== null && measuredMs * reservePerMeasured > reserveFloorMs
        ? "measured"
        : "policy-floor";
  return { reserveMs: Math.min(wanted, capMs), basis, measuredMs, capMs };
}

const reserveFloorMs = 60_000;
const reservePerMeasured = 4;
const reserveMaxShare = 0.25;
