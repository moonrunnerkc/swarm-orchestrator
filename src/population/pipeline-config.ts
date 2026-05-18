/**
 * Consolidated pipeline configuration — all feature flags that control
 * the population-manager run path in a single type so callers don't
 * need to thread a dozen individual booleans.
 *
 * C6: centralises flags that were previously scattered across RunFlags
 * and forwarded one-by-one to runPopulation().
 */

export interface PipelineConfig {
  readonly deterministic: boolean;
  readonly streaming: boolean;
  readonly postMerge: boolean;
  readonly preGeneration: boolean;
  readonly falsifiers: 'on' | 'off';
  readonly falsifierScheduler: 'sequential' | 'ucb1';
  readonly snapshotCleanup: string;
  readonly forbiddenImports: readonly string[];
  readonly tokenBudget: number | null;
  readonly mode: 'single' | 'tournament';
  readonly candidates: number | null;
  readonly maxObligations: number | null;
  readonly commandTimeoutMs: number | null;
}

export const PIPELINE_PRESETS: Record<string, Readonly<PipelineConfig>> = {
  full: {
    deterministic: true,
    streaming: true,
    postMerge: true,
    preGeneration: true,
    falsifiers: 'on',
    falsifierScheduler: 'sequential',
    snapshotCleanup: '',
    forbiddenImports: [],
    tokenBudget: null,
    mode: 'single',
    candidates: null,
    maxObligations: null,
    commandTimeoutMs: null,
  },
  fast: {
    deterministic: true,
    streaming: false,
    postMerge: false,
    preGeneration: false,
    falsifiers: 'off',
    falsifierScheduler: 'sequential',
    snapshotCleanup: 'always',
    forbiddenImports: [],
    tokenBudget: null,
    mode: 'single',
    candidates: null,
    maxObligations: null,
    commandTimeoutMs: null,
  },
  minimal: {
    deterministic: false,
    streaming: false,
    postMerge: false,
    preGeneration: false,
    falsifiers: 'off',
    falsifierScheduler: 'sequential',
    snapshotCleanup: 'always',
    forbiddenImports: [],
    tokenBudget: null,
    mode: 'single',
    candidates: null,
    maxObligations: null,
    commandTimeoutMs: null,
  },
};

export type PresetName = keyof typeof PIPELINE_PRESETS;
export const PRESET_NAMES: readonly string[] = Object.keys(PIPELINE_PRESETS);

/**
 * Resolve a PipelineConfig from an optional preset name and optional
 * per-field overrides.  When `preset` is null/undefined the "full"
 * preset is used as the baseline.  Individual overrides always win.
 */
export function resolvePipelineConfig(options: {
  preset?: PresetName | null;
  overrides?: Partial<PipelineConfig>;
}): PipelineConfig {
  const base =
    options.preset && PIPELINE_PRESETS[options.preset]
      ? PIPELINE_PRESETS[options.preset]
      : PIPELINE_PRESETS['full'];
  if (!options.overrides) return { ...base };
  return { ...base, ...options.overrides };
}