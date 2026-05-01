import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getLogger } from '../logger';
import {
  type RuleArtifactKind,
  validateRule,
} from './schemas';

/**
 * One validated rule loaded from a pack on disk. `data` is the parsed YAML or
 * JSON object the file contained, post-schema-validation. `packId` is the
 * "<author>/<name>" identity of the owning pack so consumers can attribute
 * findings back to a specific source.
 */
export interface LoadedRule {
  kind: RuleArtifactKind;
  ruleId: string;
  data: Record<string, unknown>;
  filePath: string;
  packId: string;
}

/** Manifest data describing one loaded pack. Returned by `getLoadedPacks`. */
export interface LoadedPack {
  author: string;
  name: string;
  version: string;
  ruleCount: number;
  path: string;
}

/**
 * Diagnostic recorded when the loader skipped a file or pack. Bad files do
 * NOT abort the load; consumers can inspect the errors array to surface
 * contributor-grade messages without having to re-parse the bad file.
 */
export interface RuleLoaderError {
  filePath: string;
  packId?: string;
  kind?: RuleArtifactKind;
  message: string;
}

/**
 * Inputs to `loadRules`. Defaults match the v7 plan: built-in rules ship in
 * the orchestrator's `config/built-in-rules/`, community packs install under
 * `~/.swarm/rules/`, and only packs explicitly listed in `enabledPacks` are
 * loaded from the community location. Built-in rules always load regardless
 * of `enabledPacks`.
 */
export interface RuleLoaderOptions {
  rulesDir?: string;
  builtInRulesDir?: string;
  enabledPacks?: string[];
}

export interface RuleLoaderResult {
  rules: LoadedRule[];
  packs: LoadedPack[];
  errors: RuleLoaderError[];
}

const RULE_DIRECTORY_TO_KIND: ReadonlyMap<string, RuleArtifactKind> = new Map([
  ['cheat-rules', 'cheat-rule'],
  ['property-templates', 'property-template'],
  ['regression-fixtures', 'regression-fixture'],
]);

const SUPPORTED_RULE_EXTENSIONS = ['.yaml', '.yml', '.json'];

const PACK_MANIFEST_NAMES = ['pack.yaml', 'pack.yml', 'manifest.yaml', 'manifest.yml'];

const logger = getLogger('rules-loader');

/**
 * Resolve the orchestrator's bundled built-in rules directory. Walks up from
 * `__dirname` until the repo root or until `config/built-in-rules` is found.
 * The repo root is the conventional location whether the loader is running
 * from `src/` (dev via tsx) or `dist/src/` (compiled).
 */
function defaultBuiltInRulesDir(): string {
  // Match how the existing semgrep config lookup walks parents (cheat-detector.ts).
  const candidates = [
    path.join(process.cwd(), 'config', 'built-in-rules'),
    path.join(__dirname, '..', '..', '..', 'config', 'built-in-rules'),
    path.join(__dirname, '..', '..', 'config', 'built-in-rules'),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0]!;
}

function defaultRulesDir(): string {
  return path.join(os.homedir(), '.swarm', 'rules');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRuleFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.json')) return JSON.parse(raw);
  return yaml.load(raw);
}

function readPackManifest(packDir: string): { version: string } {
  for (const name of PACK_MANIFEST_NAMES) {
    const candidate = path.join(packDir, name);
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = yaml.load(fs.readFileSync(candidate, 'utf8'));
      if (isRecord(parsed) && typeof parsed.version === 'string' && parsed.version.trim() !== '') {
        return { version: parsed.version };
      }
    } catch {
      // Manifest parse failure is not fatal; the pack still loads with default version.
    }
  }
  return { version: 'unversioned' };
}

function listPackRoots(baseDir: string): Array<{ author: string; name: string; path: string }> {
  // Pack roots live two levels deep: <base>/<author>/<name>. We discover them
  // structurally rather than reading a global registry so a contributor can
  // drop a clone of their pack into ~/.swarm/rules and have the loader find
  // it without orchestrator-side configuration.
  if (!fs.existsSync(baseDir)) return [];
  const out: Array<{ author: string; name: string; path: string }> = [];
  for (const author of fs.readdirSync(baseDir)) {
    const authorPath = path.join(baseDir, author);
    if (!fs.statSync(authorPath).isDirectory()) continue;
    for (const name of fs.readdirSync(authorPath)) {
      const namePath = path.join(authorPath, name);
      if (!fs.statSync(namePath).isDirectory()) continue;
      out.push({ author, name, path: namePath });
    }
  }
  return out;
}

function loadRulesFromPack(
  packId: string,
  packPath: string,
  errors: RuleLoaderError[],
): LoadedRule[] {
  const collected: LoadedRule[] = [];
  for (const [dirName, kind] of RULE_DIRECTORY_TO_KIND) {
    const ruleDir = path.join(packPath, dirName);
    if (!fs.existsSync(ruleDir) || !fs.statSync(ruleDir).isDirectory()) continue;
    const entries = fs.readdirSync(ruleDir);
    for (const entry of entries) {
      const filePath = path.join(ruleDir, entry);
      if (!fs.statSync(filePath).isFile()) continue;
      if (!SUPPORTED_RULE_EXTENSIONS.includes(path.extname(entry).toLowerCase())) continue;
      const loaded = loadOneRule(packId, kind, filePath, errors);
      if (loaded) collected.push(loaded);
    }
  }
  return collected;
}

function loadOneRule(
  packId: string,
  kind: RuleArtifactKind,
  filePath: string,
  errors: RuleLoaderError[],
): LoadedRule | undefined {
  let parsed: unknown;
  try {
    parsed = readRuleFile(filePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({ filePath, packId, kind, message: `parse failed: ${message}` });
    logger.error(`rule parse failed: ${filePath} — ${message}`);
    return undefined;
  }
  if (!isRecord(parsed)) {
    errors.push({ filePath, packId, kind, message: 'rule file did not contain a top-level object' });
    logger.error(`rule rejected: ${filePath} — top-level is not an object (got ${typeof parsed})`);
    return undefined;
  }
  const validation = validateRule(kind, parsed);
  if (!validation.valid) {
    const summary = validation.errors
      .map((e) => `${e.instancePath || '/'}: ${e.message ?? e.keyword}`)
      .join('; ');
    errors.push({ filePath, packId, kind, message: `schema validation failed: ${summary}` });
    logger.error(`rule rejected: ${filePath} (kind=${kind}) — ${summary}`);
    return undefined;
  }
  const ruleIdValue = parsed['ruleId'];
  if (typeof ruleIdValue !== 'string') {
    errors.push({ filePath, packId, kind, message: 'ruleId missing after schema validation; this should be impossible' });
    return undefined;
  }
  return { kind, ruleId: ruleIdValue, data: parsed, filePath, packId };
}

/**
 * Load all rules visible to the orchestrator: built-in always, plus opted-in
 * community packs from `rulesDir`. Bad files are skipped with an error
 * recorded in `result.errors`; the load never aborts on a single file.
 *
 * @param options - Override defaults for built-in dir, community rules dir,
 *                  and the explicit list of community pack ids to load.
 * @returns Validated rules, loaded-pack manifests, and per-file errors.
 */
export function loadRules(options: RuleLoaderOptions = {}): RuleLoaderResult {
  const builtInDir = options.builtInRulesDir ?? defaultBuiltInRulesDir();
  const rulesDir = options.rulesDir ?? defaultRulesDir();
  const enabled = new Set(options.enabledPacks ?? []);

  const allRules: LoadedRule[] = [];
  const allPacks: LoadedPack[] = [];
  const errors: RuleLoaderError[] = [];

  // Built-in packs always load. Per the v7 directive, they ship inside the
  // orchestrator and represent the curated baseline contributors extend.
  for (const pack of listPackRoots(builtInDir)) {
    const packId = `${pack.author}/${pack.name}`;
    const rulesFromPack = loadRulesFromPack(packId, pack.path, errors);
    allRules.push(...rulesFromPack);
    const { version } = readPackManifest(pack.path);
    allPacks.push({ author: pack.author, name: pack.name, version, ruleCount: rulesFromPack.length, path: pack.path });
  }

  // Community packs load only when the operator explicitly opts in. Packs on
  // disk but not in `enabledPacks` are silently ignored — installation alone
  // does not grant a third-party pack the right to inject rules.
  const communityPacks = listPackRoots(rulesDir);
  const communityPackIndex = new Map(communityPacks.map((p) => [`${p.author}/${p.name}`, p]));
  for (const packId of enabled) {
    const located = communityPackIndex.get(packId);
    if (!located) {
      const expected = path.join(rulesDir, packId);
      const message =
        `configured rule pack '${packId}' not found at ${expected}; ` +
        'install it by cloning the pack repo into ~/.swarm/rules/<author>/<name>/ ' +
        '(swarm rules install <pack> is planned but not yet available).';
      errors.push({ filePath: expected, packId, message });
      logger.error(message);
      continue;
    }
    const rulesFromPack = loadRulesFromPack(packId, located.path, errors);
    allRules.push(...rulesFromPack);
    const { version } = readPackManifest(located.path);
    allPacks.push({ author: located.author, name: located.name, version, ruleCount: rulesFromPack.length, path: located.path });
  }

  return { rules: allRules, packs: allPacks, errors };
}

/**
 * Convenience: return loaded packs from a prior `loadRules` result. Surfaces
 * the "what packs are active" question without asking callers to filter the
 * full result object themselves.
 */
export function getLoadedPacks(result: RuleLoaderResult): LoadedPack[] {
  return result.packs;
}

/**
 * Process-wide cached load. Set by `initActiveRules` once at CLI startup so
 * downstream consumers (cheat detector, future regression falsifier, …) all
 * see the same rule set the operator opted into via `.swarm/config.yaml`.
 * Without this cache, each consumer's independent `loadRules()` call would
 * default to built-in only and silently drop community packs.
 */
let activeRulesCache: RuleLoaderResult | undefined;

/**
 * Initialize the process-wide active rule set. Idempotent: a second call with
 * the same arguments overwrites the cache. The CLI entry point calls this
 * after parsing config; consumers downstream call `getActiveRules()` to read.
 *
 * @param options - Same overrides accepted by `loadRules`.
 * @returns The result of the underlying `loadRules` invocation, also cached.
 */
export function initActiveRules(options: RuleLoaderOptions = {}): RuleLoaderResult {
  activeRulesCache = loadRules(options);
  return activeRulesCache;
}

/**
 * Read the cached active rule set. If `initActiveRules` was never called
 * (e.g., a unit test that imports the cheat detector without going through
 * the CLI startup path), falls back to a default-options load so behavior
 * remains correct, just without community-pack visibility.
 */
export function getActiveRules(): RuleLoaderResult {
  if (!activeRulesCache) {
    activeRulesCache = loadRules();
  }
  return activeRulesCache;
}

/** Reset the cache. Test-only. Not exported beyond the package boundary in spirit. */
export function resetActiveRulesForTests(): void {
  activeRulesCache = undefined;
}

/**
 * Read `.swarm/config.yaml` from a project root and extract the rule-loader
 * fields. Returns the empty object when no config file or no relevant fields
 * exist; never throws on missing or malformed config so the loader stays
 * usable in repos that have not opted into custom packs.
 */
export function readRuleLoaderConfig(projectRoot: string): RuleLoaderOptions {
  const configPath = path.join(projectRoot, '.swarm', 'config.yaml');
  if (!fs.existsSync(configPath)) return {};
  let parsed: unknown;
  try {
    parsed = yaml.load(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`could not parse ${configPath}: ${message}`);
    return {};
  }
  if (!isRecord(parsed)) return {};
  const opts: RuleLoaderOptions = {};
  if (typeof parsed['rules_dir'] === 'string' && parsed['rules_dir'].trim() !== '') {
    opts.rulesDir = parsed['rules_dir'];
  }
  if (Array.isArray(parsed['rule_packs'])) {
    const enabled = parsed['rule_packs'].filter((p): p is string => typeof p === 'string');
    if (enabled.length > 0) opts.enabledPacks = enabled;
  }
  return opts;
}
