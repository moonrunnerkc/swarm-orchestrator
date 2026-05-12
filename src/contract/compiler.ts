import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { checkPredicateBaseline } from '../verification/predicate-runner';
import { DEFAULT_STRATEGY_NAMES } from '../wasm/registry';
import { canonicalSort, contractHash, contractIdFromHash } from './canonicalize';
import { type Extractor } from './extractor/types';
import { tagObligations } from './tagger';
import {
  CONTRACT_SCHEMA_VERSION,
  type ContractManifest,
  type DraftContract,
  type FinalContract,
  type ObligationV1,
  type RepoContext,
  type TautologyWarning,
} from './types';
import { validateObligations, type ValidationError } from './validator';

/** Options to `compileGoal`. */
export interface CompileOptions {
  /** Natural-language goal text. */
  goal: string;
  /** Repo context produced by `discoverRepoContext` or built by the caller. */
  repoContext: RepoContext;
  /** Extractor implementation to use. */
  extractor: Extractor;
  /**
   * Phase 5: when set to false, skip the deterministic-strategy
   * auto-tagger. Default true — tagging is opt-out so production
   * compilation always considers the deterministic floor. Tests that
   * want to inspect raw extractor output use this flag.
   */
  autoTagDeterministic?: boolean;
  /**
   * Phase 5: explicit list of strategy names available to the tagger.
   * Defaults to `DEFAULT_STRATEGY_NAMES` (the three first-party
   * strategies). Custom runtimes pass their own list.
   */
  availableStrategies?: readonly string[];
}

/**
 * Error thrown by the compiler when validation rejects extractor output.
 * Carries the raw obligations and validation errors so the CLI handler can
 * present a useful message without re-running the LLM call.
 */
export class ContractValidationError extends Error {
  readonly obligations: ObligationV1[];
  readonly validationErrors: ValidationError[];

  constructor(obligations: ObligationV1[], errors: ValidationError[]) {
    const detail = errors.map((e) => `[${e.code}] ${e.message}`).join('\n  ');
    super(`contract validation failed:\n  ${detail}`);
    this.name = 'ContractValidationError';
    this.obligations = obligations;
    this.validationErrors = errors;
  }
}

/**
 * Compile a natural-language goal into a draft contract.
 *
 * Pipeline:
 *   1. Extractor produces candidate obligations from goal + repoContext.
 *   2. Validator checks v1 schema and cross-cutting rules.
 *   3. Canonicalizer sorts the obligations into stable order.
 *   4. Compiler returns the DraftContract with extractor provenance.
 *
 * Throws `ContractValidationError` when validation fails. The caller can
 * inspect `error.obligations` and `error.validationErrors` to render a
 * useful message and offer the user the chance to edit and re-validate.
 */
export async function compileGoal(options: CompileOptions): Promise<DraftContract> {
  const extracted = await options.extractor.extract({
    goal: options.goal,
    repoContext: options.repoContext,
  });
  const requireBuild = options.repoContext.buildCommand !== null;
  const validation = validateObligations(extracted.obligations, { requireBuild });
  if (!validation.valid) {
    throw new ContractValidationError(extracted.obligations, validation.errors);
  }

  // Drop property-must-hold obligations whose predicate already exits
  // zero against the unmodified workspace. These tautologies inflate
  // the satisfied-count without measuring any actual change — the
  // exact failure mode that produced "8/13 satisfied" with zero code
  // emitted in the May 2026 eval run. We only check when repoRoot
  // resolves to a real directory; in unit tests with synthetic
  // contexts (/tmp/example-ts etc.) we skip the check.
  const { obligations: filteredObligations, tautologyWarnings } = filterBaselineTautologies(
    extracted.obligations,
    options.repoContext.repoRoot,
  );

  const autoTag = options.autoTagDeterministic ?? true;
  const tagged = autoTag
    ? tagObligations(filteredObligations, {
        availableStrategies: options.availableStrategies ?? DEFAULT_STRATEGY_NAMES,
      })
    : filteredObligations.slice();
  const canonical = canonicalSort(tagged);
  const draft: DraftContract = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    goal: options.goal,
    repoContext: options.repoContext,
    obligations: canonical,
    extractor: extracted.provenance,
  };
  if (tautologyWarnings.length > 0) {
    draft.tautologyWarnings = tautologyWarnings;
  }
  return draft;
}

/**
 * Walk the extractor's property-must-hold obligations, running each
 * predicate against the unmodified workspace. Predicates that exit
 * zero (the property already holds) are tautological — they require
 * no work from any persona — and are dropped from the contract.
 * Other obligation types pass through unchanged.
 *
 * Returns the filtered list and a parallel list of warnings explaining
 * which obligations were dropped and why. Skips the baseline check
 * entirely when `repoRoot` does not resolve to a readable directory
 * (unit tests use synthetic repoContexts like `/tmp/example-ts`).
 */
function filterBaselineTautologies(
  obligations: readonly ObligationV1[],
  repoRoot: string,
): { obligations: ObligationV1[]; tautologyWarnings: TautologyWarning[] } {
  // Bail out early if the workspace isn't real on disk. The validator
  // already ensured the obligations are syntactically valid; this step
  // is a semantic check that needs a real filesystem.
  if (!fs.existsSync(repoRoot) || !fs.statSync(repoRoot).isDirectory()) {
    return { obligations: obligations.slice(), tautologyWarnings: [] };
  }
  const kept: ObligationV1[] = [];
  const warnings: TautologyWarning[] = [];
  for (const obligation of obligations) {
    if (obligation.type !== 'property-must-hold') {
      kept.push(obligation);
      continue;
    }
    const baseline = checkPredicateBaseline(obligation.predicate, repoRoot);
    if (baseline.ok) {
      warnings.push({
        obligation,
        reason:
          `predicate already exits zero on the unmodified workspace ` +
          `("${obligation.target}"); the obligation cannot measure any change ` +
          `and would be trivially satisfied by every persona response`,
      });
      continue;
    }
    kept.push(obligation);
  }
  return { obligations: kept, tautologyWarnings: warnings };
}

/**
 * Finalize a draft contract: compute its hash, derive its id, stamp a
 * created-at timestamp, and assemble the on-disk manifest. Pure: no I/O.
 *
 * Re-validation is a defensive sweep: the draft is supposed to be valid by
 * construction, so a failure here is a programmer error not a user error.
 */
export function finalize(draft: DraftContract, now: Date = new Date()): FinalContract {
  const requireBuild = draft.repoContext.buildCommand !== null;
  const validation = validateObligations(draft.obligations, { requireBuild });
  if (!validation.valid) {
    throw new ContractValidationError(draft.obligations, validation.errors);
  }
  const hash = contractHash(draft.obligations);
  const manifest: ContractManifest = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractHash: hash,
    contractId: contractIdFromHash(hash),
    goal: draft.goal,
    repoContext: draft.repoContext,
    extractor: draft.extractor,
    createdAt: now.toISOString(),
  };
  return { manifest, obligations: draft.obligations };
}

/**
 * Build a `RepoContext` for the given project root by reading package.json
 * and probing for known language signals. Pure read-only inspection.
 *
 * - buildCommand: derived from `scripts.build` (npm-shaped) when present.
 * - testCommand: derived from `scripts.test` when present, with package
 *   manager prefix from lockfile detection (mirrors the convention used by
 *   `src/test-command-discovery.ts`).
 * - language: 'typescript' when tsconfig.json exists, 'javascript' when only
 *   package.json exists, 'python' when pyproject.toml or requirements.txt
 *   exists, else 'unknown'.
 */
export function discoverRepoContext(repoRoot: string): RepoContext {
  const buildCommand = discoverBuildCommand(repoRoot);
  const testCommand = discoverTestCommandLocal(repoRoot);
  const language = detectLanguage(repoRoot);
  const testFramework = detectTestFramework(repoRoot, language);
  const ctx: RepoContext = {
    repoRoot,
    buildCommand,
    testCommand,
    language,
  };
  // Field is optional under exactOptionalPropertyTypes; only assign when
  // we have an actual value (including explicit `null` for "looked but
  // found nothing"). Leaving the key absent for undetected projects keeps
  // older manifests bit-identical.
  if (testFramework !== undefined) ctx.testFramework = testFramework;
  return ctx;
}

function discoverBuildCommand(repoRoot: string): string | null {
  const pkg = readPackageJsonScripts(repoRoot);
  if (!pkg) return null;
  if (pkg.scripts && typeof pkg.scripts.build === 'string' && pkg.scripts.build.trim() !== '') {
    return `${pkg.packageManager} run build`;
  }
  return null;
}

function discoverTestCommandLocal(repoRoot: string): string | null {
  const pkg = readPackageJsonScripts(repoRoot);
  if (!pkg) return null;
  if (pkg.scripts && typeof pkg.scripts.test === 'string' && pkg.scripts.test.trim() !== '') {
    return `${pkg.packageManager} test`;
  }
  return null;
}

interface PackageJsonProbe {
  scripts: Record<string, string> | null;
  packageManager: 'pnpm' | 'yarn' | 'npm';
}

function readPackageJsonScripts(repoRoot: string): PackageJsonProbe | null {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return null;
  let parsed: { scripts?: Record<string, string>; packageManager?: unknown };
  try {
    parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch {
    return null;
  }
  const declared = parsed.packageManager;
  return {
    scripts: parsed.scripts ?? null,
    packageManager: detectPackageManager(repoRoot, declared),
  };
}

/**
 * Pick the package manager the project actually uses. Priority:
 *   1. The `packageManager` field in package.json (corepack's canonical
 *      signal: `"packageManager": "yarn@4.0.0"` etc.). When present and
 *      parseable, it wins regardless of lockfiles — the project owner
 *      stated which manager to use.
 *   2. Lockfile presence AND the manager's CLI being on PATH. We never
 *      claim "yarn" if `yarn` is not installed, because every downstream
 *      `yarn test` will exit 127 and waste the run.
 *   3. Fall back to `npm` (every Node install ships it).
 *
 * The earlier heuristic — first lockfile wins — silently broke runs in
 * repos with stale lockfiles (e.g. `yarn.lock` left behind after a
 * migration to npm).
 */
export function detectPackageManager(
  repoRoot: string,
  declaredPackageManager: unknown = undefined,
): 'pnpm' | 'yarn' | 'npm' {
  // 1. Honor an explicit corepack `packageManager` declaration.
  if (typeof declaredPackageManager === 'string') {
    const head = declaredPackageManager.split('@')[0]?.trim();
    if (head === 'pnpm' || head === 'yarn' || head === 'npm') return head;
  }

  // 2. Lockfile + on-PATH.
  const candidates: Array<{ name: 'pnpm' | 'yarn' | 'npm'; lockfile: string }> = [
    { name: 'pnpm', lockfile: 'pnpm-lock.yaml' },
    { name: 'yarn', lockfile: 'yarn.lock' },
    { name: 'npm', lockfile: 'package-lock.json' },
  ];
  for (const { name, lockfile } of candidates) {
    if (fs.existsSync(path.join(repoRoot, lockfile)) && isCommandOnPath(name)) {
      return name;
    }
  }

  // 3. Universal default — Node ships npm.
  return 'npm';
}

/**
 * Return true when `command` resolves on PATH. Uses `which` (POSIX)
 * with stdio suppressed; throws are interpreted as "not on PATH".
 * `process.env.PATHEXT` isn't relevant since swarm-orchestrator targets
 * macOS/Linux.
 */
function isCommandOnPath(command: string): boolean {
  try {
    execSync(`command -v ${command}`, { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the project's test framework from package.json (Node projects)
 * or pyproject.toml/requirements.txt (Python). Returns null when the signal
 * is absent or ambiguous. The detector is deliberately narrow — only
 * frameworks we know how to write idiomatic tests for ship a label —
 * because a wrong label is worse than no label (the architect would
 * confidently emit Jest API into a Mocha project).
 *
 * Detection rules, first match wins:
 *   - Node: explicit dep on `jest`/`vitest`/`mocha` ⇒ that framework.
 *     Otherwise, if the test script invokes `node --test` (or the
 *     equivalent), treat as Node's built-in `node:test` runner.
 *   - Python: dep on `pytest` (in pyproject.toml or requirements.txt) or
 *     a pytest.ini/tox.ini ⇒ pytest.
 */
type TestFrameworkLabel = 'jest' | 'mocha' | 'vitest' | 'node-test' | 'pytest' | null;

function detectTestFramework(
  repoRoot: string,
  language: RepoContext['language'],
): TestFrameworkLabel {
  if (language === 'typescript' || language === 'javascript') {
    return detectNodeTestFramework(repoRoot);
  }
  if (language === 'python') {
    return detectPythonTestFramework(repoRoot);
  }
  return null;
}

function detectNodeTestFramework(repoRoot: string): TestFrameworkLabel {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return null;
  let parsed: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch {
    return null;
  }
  const allDeps: Record<string, string> = {
    ...(parsed.dependencies ?? {}),
    ...(parsed.devDependencies ?? {}),
  };
  if ('jest' in allDeps) return 'jest';
  if ('vitest' in allDeps) return 'vitest';
  if ('mocha' in allDeps) return 'mocha';
  const testScript = parsed.scripts?.test ?? '';
  // Node's built-in runner. Match `node --test`, `node:test`, and the
  // common `--test` shorthand that piggybacks on a test file glob.
  if (/\bnode\b[^|;&]*--test\b/.test(testScript)) return 'node-test';
  if (/\bnode:test\b/.test(testScript)) return 'node-test';
  return null;
}

function detectPythonTestFramework(repoRoot: string): TestFrameworkLabel {
  if (
    fs.existsSync(path.join(repoRoot, 'pytest.ini')) ||
    fs.existsSync(path.join(repoRoot, 'tox.ini'))
  ) {
    return 'pytest';
  }
  const pyproject = path.join(repoRoot, 'pyproject.toml');
  if (fs.existsSync(pyproject)) {
    try {
      const txt = fs.readFileSync(pyproject, 'utf8');
      if (/\bpytest\b/.test(txt)) return 'pytest';
    } catch {
      /* fall through */
    }
  }
  const reqs = path.join(repoRoot, 'requirements.txt');
  if (fs.existsSync(reqs)) {
    try {
      const txt = fs.readFileSync(reqs, 'utf8');
      if (/^pytest\b/m.test(txt)) return 'pytest';
    } catch {
      /* fall through */
    }
  }
  return null;
}

function detectLanguage(repoRoot: string): RepoContext['language'] {
  if (fs.existsSync(path.join(repoRoot, 'tsconfig.json'))) return 'typescript';
  if (
    fs.existsSync(path.join(repoRoot, 'pyproject.toml')) ||
    fs.existsSync(path.join(repoRoot, 'requirements.txt'))
  ) {
    return 'python';
  }
  if (fs.existsSync(path.join(repoRoot, 'package.json'))) return 'javascript';
  return 'unknown';
}
