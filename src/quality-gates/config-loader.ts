import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { DEFAULT_QUALITY_GATES_CONFIG } from './default-config';
import { QualityGatesConfig } from './types';

/** Gate config keys that correspond to actual quality gates. */
const VALID_GATE_KEYS: ReadonlySet<string> = new Set([
  'scaffoldDefaults',
  'duplicateBlocks',
  'hardcodedConfig',
  'readmeClaims',
  'testIsolation',
  'testCoverage',
  'testFileProtection',
  'accessibility',
  'runtimeChecks',
]);

function is_object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate that all gate keys in a user-provided config are recognized.
 * Throws a descriptive error listing valid names when unknown keys are found.
 * @param parsed - The parsed YAML object
 * @param sourcePath - File path for error messages
 */
function validate_gate_keys(parsed: Record<string, unknown>, sourcePath: string): void {
  const gates = parsed.gates;
  if (!is_object(gates)) return;

  const unknownKeys = Object.keys(gates).filter(k => !VALID_GATE_KEYS.has(k));
  if (unknownKeys.length > 0) {
    const validList = Array.from(VALID_GATE_KEYS).sort().join(', ');
    throw new Error(
      `Unknown gate key(s) in ${sourcePath}: ${unknownKeys.join(', ')}. ` +
      `Valid gate keys: ${validList}`
    );
  }
}

function merge_config(base: QualityGatesConfig, override: Partial<QualityGatesConfig>): QualityGatesConfig {
  const merged: QualityGatesConfig = {
    ...base,
    ...override,
    gates: {
      ...base.gates,
      ...(override.gates || {})
    }
  };

  // deep merge for each gate
  merged.gates = {
    scaffoldDefaults: { ...base.gates.scaffoldDefaults, ...(override.gates?.scaffoldDefaults || {}) },
    duplicateBlocks: { ...base.gates.duplicateBlocks, ...(override.gates?.duplicateBlocks || {}) },
    hardcodedConfig: { ...base.gates.hardcodedConfig, ...(override.gates?.hardcodedConfig || {}) },
    readmeClaims: { ...base.gates.readmeClaims, ...(override.gates?.readmeClaims || {}) },
    testIsolation: { ...base.gates.testIsolation, ...(override.gates?.testIsolation || {}) },
    runtimeChecks: { ...base.gates.runtimeChecks, ...(override.gates?.runtimeChecks || {}) },
    accessibility: { ...base.gates.accessibility, ...(override.gates?.accessibility || {}) },
    testCoverage: { ...base.gates.testCoverage, ...(override.gates?.testCoverage || {}) },
    testFileProtection: { ...base.gates.testFileProtection, ...(override.gates?.testFileProtection || {}) }
  };

  return merged;
}

/**
 * Load a YAML config file, validate it, and return the parsed object.
 * Throws on YAML syntax errors with the file path in the message.
 * @param filePath - Absolute path to the YAML file
 * @returns Parsed config as a partial QualityGatesConfig
 */
function load_yaml_config(filePath: string): Partial<QualityGatesConfig> {
  const raw = fs.readFileSync(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`YAML syntax error in ${filePath}: ${msg}`);
  }

  if (!parsed || (is_object(parsed) && Object.keys(parsed).length === 0)) {
    return {};
  }

  if (!is_object(parsed)) {
    throw new Error(`Quality gates config must be a YAML object: ${filePath}`);
  }

  validate_gate_keys(parsed, filePath);
  return parsed as Partial<QualityGatesConfig>;
}

/**
 * Resolve quality gate configuration using a three-layer merge strategy:
 * 1. Built-in defaults
 * 2. Per-project `.swarm/gates.yaml` (if present in repoRoot)
 * 3. Explicit path from `--quality-gates-config` flag (if provided)
 *
 * Unknown gate keys in user-provided configs cause a descriptive error.
 * YAML syntax errors surface with the file path included.
 *
 * @param projectRoot - Root directory of the target repository
 * @param explicitPath - Optional explicit config path from CLI flag
 * @returns Fully resolved quality gates configuration
 */
export function load_quality_gates_config(projectRoot: string, explicitPath?: string): QualityGatesConfig {
  // Start with a defensive copy so callers never mutate the shared default
  let config = merge_config(DEFAULT_QUALITY_GATES_CONFIG, {});

  // Layer 2: per-project .swarm/gates.yaml
  const perProjectPath = path.join(projectRoot, '.swarm', 'gates.yaml');
  if (fs.existsSync(perProjectPath)) {
    const perProject = load_yaml_config(perProjectPath);
    if (Object.keys(perProject).length > 0) {
      config = merge_config(config, perProject);
    }
  }

  // Layer 3: explicit path from --quality-gates-config flag
  if (explicitPath) {
    const resolved = path.isAbsolute(explicitPath) ? explicitPath : path.join(projectRoot, explicitPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Quality gates config file not found: ${resolved}`);
    }
    const explicit = load_yaml_config(resolved);
    if (Object.keys(explicit).length > 0) {
      config = merge_config(config, explicit);
    }
  }

  // Legacy fallback: config/quality-gates.yaml in the project root
  // Only applies when neither .swarm/gates.yaml nor explicit path was used
  if (!explicitPath && !fs.existsSync(perProjectPath)) {
    const legacyPath = path.join(projectRoot, 'config', 'quality-gates.yaml');
    if (fs.existsSync(legacyPath)) {
      const legacy = load_yaml_config(legacyPath);
      if (Object.keys(legacy).length > 0) {
        config = merge_config(config, legacy);
      }
    }
  }

  return config;
}
