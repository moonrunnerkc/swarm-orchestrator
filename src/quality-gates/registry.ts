import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_QUALITY_GATES_CONFIG } from './default-config';
import { run_accessibility_gate } from './gates/accessibility';
import { run_duplicate_blocks_gate } from './gates/duplicate-blocks';
import { run_hardcoded_config_gate } from './gates/hardcoded-config';
import { run_readme_claims_gate } from './gates/readme-claims';
import { run_runtime_checks_gate } from './gates/runtime-checks';
import { run_scaffold_defaults_gate } from './gates/scaffold-defaults';
import { run_test_coverage_gate } from './gates/test-coverage';
import { run_test_file_protection_gate } from './gates/test-file-protection';
import { run_test_isolation_gate } from './gates/test-isolation';
import {
  GateContext,
  GateResult,
  GenericGateConfig,
} from './types';

export interface RegisteredQualityGate<TConfig extends GenericGateConfig = GenericGateConfig> {
  key: string;
  title: string;
  defaultConfig: TConfig;
  run(ctx: GateContext, config: TConfig, maxFileSizeBytes: number): Promise<GateResult>;
}

type ProjectGateModule = {
  registerGates?: (api: { registerGate: (gate: RegisteredQualityGate) => void }) => void;
  gates?: RegisteredQualityGate[];
  default?: RegisteredQualityGate[] | ((api: { registerGate: (gate: RegisteredQualityGate) => void }) => void);
};

const registry = new Map<string, RegisteredQualityGate>();
const builtInKeys = new Set<string>();
const projectKeys = new Set<string>();

function registerBuiltInGate<TConfig extends GenericGateConfig>(gate: RegisteredQualityGate<TConfig>): void {
  registry.set(gate.key, gate);
  builtInKeys.add(gate.key);
}

export function registerGate<TConfig extends GenericGateConfig>(gate: RegisteredQualityGate<TConfig>): void {
  registry.set(gate.key, gate);
  projectKeys.add(gate.key);
}

export function resetProjectGates(): void {
  for (const key of projectKeys) {
    if (!builtInKeys.has(key)) {
      registry.delete(key);
    }
  }
  projectKeys.clear();
}

export function getRegisteredGates(): RegisteredQualityGate[] {
  return Array.from(registry.values());
}

export function getRegisteredGateKeys(): string[] {
  return getRegisteredGates().map(gate => gate.key);
}

function resolveProjectGateModule(projectRoot: string): string | null {
  const candidates = [
    path.join(projectRoot, '.swarm', 'gates', 'index.js'),
    path.join(projectRoot, '.swarm', 'gates', 'index.cjs'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function registerProjectExports(entry: ProjectGateModule): void {
  if (typeof entry.registerGates === 'function') {
    entry.registerGates({ registerGate });
    return;
  }

  if (Array.isArray(entry.gates)) {
    for (const gate of entry.gates) registerGate(gate);
    return;
  }

  if (typeof entry.default === 'function') {
    entry.default({ registerGate });
    return;
  }

  if (Array.isArray(entry.default)) {
    for (const gate of entry.default) registerGate(gate);
  }
}

export function loadProjectGateRegistrations(projectRoot: string): string[] {
  resetProjectGates();
  const entryPath = resolveProjectGateModule(projectRoot);
  if (!entryPath) return [];

  delete require.cache[require.resolve(entryPath)];
  const loaded = require(entryPath) as ProjectGateModule;
  registerProjectExports(loaded);
  return [entryPath];
}

/**
 * Gate keys that are "self-improvement" gates — the orchestrator applies
 * them to its OWN generated code to enforce quality on code it produced.
 * When the orchestrator is running against a target repo (swarm bootstrap
 * against an external codebase), these gates should NOT fire: the target
 * has its own conventions and the gates misattribute target-repo features
 * as agent defects. Phase 4a smoke4 evidence: the accessibility gate
 * flagged sympy (computer-algebra library, no UI) and triggered replan
 * churn that wasted cycles and polluted the diff-capture.
 *
 * Gates NOT in this set are "universal" — they enforce agent-behavior
 * contracts that apply regardless of whose codebase is being modified:
 *   - hardcodedConfig       agent must not add secrets / hardcoded config
 *                           (the gate scopes to baselineFiles, so it only
 *                           flags what the agent added, not pre-existing
 *                           target state — safe in target mode)
 *   - testFileProtection    agent must not modify pre-existing test files
 *                           (SWE-bench evaluation integrity + general
 *                           safety property; always fires)
 *
 * `run_quality_gates` consults this set via the `skippedGateKeys` param
 * the orchestrator passes when `targetMode === true`.
 */
export const SELF_IMPROVEMENT_GATE_KEYS: ReadonlySet<string> = new Set([
  'scaffoldDefaults',
  'duplicateBlocks',
  'readmeClaims',
  'testIsolation',
  'runtimeChecks',
  'accessibility',
  'testCoverage',
]);

registerBuiltInGate({
  key: 'scaffoldDefaults',
  title: 'Scaffold Defaults',
  defaultConfig: DEFAULT_QUALITY_GATES_CONFIG.gates.scaffoldDefaults,
  run: (ctx, config, maxFileSizeBytes) => run_scaffold_defaults_gate(ctx, config, maxFileSizeBytes),
});

registerBuiltInGate({
  key: 'duplicateBlocks',
  title: 'Duplicate Blocks',
  defaultConfig: DEFAULT_QUALITY_GATES_CONFIG.gates.duplicateBlocks,
  run: (ctx, config, maxFileSizeBytes) => run_duplicate_blocks_gate(ctx, config, maxFileSizeBytes),
});

registerBuiltInGate({
  key: 'hardcodedConfig',
  title: 'Hardcoded Config',
  defaultConfig: DEFAULT_QUALITY_GATES_CONFIG.gates.hardcodedConfig,
  run: (ctx, config, maxFileSizeBytes) => run_hardcoded_config_gate(ctx, config, maxFileSizeBytes),
});

registerBuiltInGate({
  key: 'readmeClaims',
  title: 'README Claims',
  defaultConfig: DEFAULT_QUALITY_GATES_CONFIG.gates.readmeClaims,
  run: (ctx, config, maxFileSizeBytes) => run_readme_claims_gate(ctx, config, maxFileSizeBytes),
});

registerBuiltInGate({
  key: 'testIsolation',
  title: 'Test Isolation',
  defaultConfig: DEFAULT_QUALITY_GATES_CONFIG.gates.testIsolation,
  run: (ctx, config, maxFileSizeBytes) => run_test_isolation_gate(ctx, config, maxFileSizeBytes),
});

registerBuiltInGate({
  key: 'runtimeChecks',
  title: 'Runtime Checks',
  defaultConfig: DEFAULT_QUALITY_GATES_CONFIG.gates.runtimeChecks,
  run: (ctx, config) => run_runtime_checks_gate(ctx.projectRoot, config, ctx.baseCommit),
});

registerBuiltInGate({
  key: 'accessibility',
  title: 'Accessibility',
  defaultConfig: DEFAULT_QUALITY_GATES_CONFIG.gates.accessibility,
  run: (ctx, config, maxFileSizeBytes) => run_accessibility_gate(ctx, config, maxFileSizeBytes),
});

registerBuiltInGate({
  key: 'testCoverage',
  title: 'Test Coverage',
  defaultConfig: DEFAULT_QUALITY_GATES_CONFIG.gates.testCoverage,
  run: (ctx, config, maxFileSizeBytes) => run_test_coverage_gate(ctx, config, maxFileSizeBytes),
});

registerBuiltInGate({
  key: 'testFileProtection',
  title: 'Test File Protection',
  defaultConfig: DEFAULT_QUALITY_GATES_CONFIG.gates.testFileProtection,
  run: (ctx, config) => run_test_file_protection_gate(ctx.projectRoot, config, ctx.baseCommit),
});
