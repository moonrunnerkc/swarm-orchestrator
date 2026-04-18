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
