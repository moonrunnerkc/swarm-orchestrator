import * as fs from 'fs';
import * as path from 'path';
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
  const autoTag = options.autoTagDeterministic ?? true;
  const tagged = autoTag
    ? tagObligations(extracted.obligations, {
        availableStrategies: options.availableStrategies ?? DEFAULT_STRATEGY_NAMES,
      })
    : extracted.obligations.slice();
  const canonical = canonicalSort(tagged);
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    goal: options.goal,
    repoContext: options.repoContext,
    obligations: canonical,
    extractor: extracted.provenance,
  };
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
  let parsed: { scripts?: Record<string, string> };
  try {
    parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch {
    return null;
  }
  return {
    scripts: parsed.scripts ?? null,
    packageManager: detectPackageManager(repoRoot),
  };
}

function detectPackageManager(repoRoot: string): 'pnpm' | 'yarn' | 'npm' {
  if (fs.existsSync(path.join(repoRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(repoRoot, 'yarn.lock'))) return 'yarn';
  return 'npm';
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
