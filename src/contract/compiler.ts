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

export interface CompileOptions {
  goal: string;
  repoContext: RepoContext;
  extractor: Extractor;
  // Default true — tagging is opt-out so production compilation always
  // considers the deterministic floor. Tests inspecting raw extractor
  // output use this flag.
  autoTagDeterministic?: boolean;
  availableStrategies?: readonly string[];
}

// Carries raw obligations and validation errors so the CLI handler can
// render a useful message without re-running the LLM call.
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
  // zero against the unmodified workspace — May 2026 eval ran with
  // "8/13 satisfied" and zero code emitted because of this failure mode.
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

// Skips baseline checks for synthetic repoContexts (unit tests use
// paths like /tmp/example-ts that don't resolve to a real directory).
function filterBaselineTautologies(
  obligations: readonly ObligationV1[],
  repoRoot: string,
): { obligations: ObligationV1[]; tautologyWarnings: TautologyWarning[] } {
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

// Re-validation here is a defensive sweep: drafts are valid by
// construction, so a failure here is a programmer error.
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
  // exactOptionalPropertyTypes: leaving the key absent for undetected
  // projects keeps older manifests bit-identical.
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

// Earlier "first lockfile wins" heuristic broke runs in repos with
// stale lockfiles (yarn.lock left over after npm migration). Lockfile
// + on-PATH is the gate so we never claim "yarn" when yarn is missing.
// Corepack's `packageManager` declaration wins when present.
export function detectPackageManager(
  repoRoot: string,
  declaredPackageManager: unknown = undefined,
): 'pnpm' | 'yarn' | 'npm' {
  if (typeof declaredPackageManager === 'string') {
    const head = declaredPackageManager.split('@')[0]?.trim();
    if (head === 'pnpm' || head === 'yarn' || head === 'npm') return head;
  }

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

  return 'npm';
}

function isCommandOnPath(command: string): boolean {
  try {
    execSync(`command -v ${command}`, { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

// Narrow on purpose: a wrong label is worse than no label because the
// architect would confidently emit Jest API into a Mocha project.
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
