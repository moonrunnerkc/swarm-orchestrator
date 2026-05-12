import type { PersonaSpec } from './types';

/**
 * Strict output rules shared by every persona whose contract is to
 * emit a unified diff. LLMs routinely prefix diffs with prose ("Here is
 * the patch:") or wrap them in ```diff fences; the population manager's
 * parser tolerates both via stripDiffPreamble, but enforcing the strict
 * form here lowers the parse-failure rate measurably.
 *
 * The format requirements (--- a/path then +++ b/path then @@ hunk) are
 * the unified-diff parser's actual inputs; deviations are silently
 * stripped or rejected. The "first character must be '-'" line is a
 * hard test the verifier can apply at candidate time without parsing
 * the whole body.
 */
const STRICT_UNIFIED_DIFF_RULES = [
  '',
  'Output rules (strict):',
  '- Reply with a unified diff and nothing else.',
  '- No prose before, after, or between hunks. No "Here is the diff:".',
  '- No code fences. No ```diff or ``` wrappers.',
  '- The first character of your response MUST be a `-` from a `--- a/<path>`',
  '  header line. The second line MUST be a `+++ b/<path>` header.',
  '- New files use `--- /dev/null` and `+++ b/<path>`. Deletions use',
  '  `--- a/<path>` and `+++ /dev/null`.',
  '- Repo-relative paths only; no absolute paths, no leading `./`.',
  '- If the obligation already holds and no change is needed, reply with',
  '  the literal three characters: no-op',
  '',
  'CRITICAL — diff context anchoring:',
  'When the prompt includes a "Current contents of <path>:" block, every',
  '` ` (context) line and every `-` (delete) line in your hunks for that',
  'path MUST appear VERBATIM in the file shown — same characters, same',
  'indentation, same surrounding lines. Do not paraphrase. Do not invent',
  'helper lines that "should" be there. Do not assume what the file looks',
  'like beyond what is shown. The parser does byte-for-byte context',
  'matching; a single wrong character rejects the entire diff. If you',
  'cannot find a clean anchor in the shown file, narrow your hunk to a',
  'smaller, more reliably-anchored slice.',
].join('\n');

/**
 * Registry of persona specs. Phase 2 ships three: `architect`, `implementer`,
 * `verifier` (impl guide §5). Phase 7 expands the population to eight by
 * adding `security-reviewer`, `dependency-auditor`, `documentation-writer`,
 * `migration-specialist`, and `test-author` (impl guide §10), one per
 * Phase 7 obligation type.
 *
 * The registry is a pure in-memory key/value store; persistence happens in
 * the ledger and the contract, not here.
 */
export class PersonaRegistry {
  private readonly byId: Map<string, PersonaSpec>;

  constructor(initial: readonly PersonaSpec[] = []) {
    this.byId = new Map();
    for (const p of initial) this.register(p);
  }

  /**
   * Register a persona. Throws if a persona with the same id already exists;
   * use `replace()` for explicit overwrite.
   */
  register(spec: PersonaSpec): void {
    if (this.byId.has(spec.id)) {
      throw new Error(
        `persona "${spec.id}" already registered; use replace() for explicit overwrite`,
      );
    }
    this.byId.set(spec.id, spec);
  }

  /** Replace an existing persona. */
  replace(spec: PersonaSpec): void {
    this.byId.set(spec.id, spec);
  }

  /** Lookup a persona by id. Returns null when absent. */
  get(id: string): PersonaSpec | null {
    return this.byId.get(id) ?? null;
  }

  /** Lookup a persona by id; throws when absent. */
  require(id: string): PersonaSpec {
    const found = this.byId.get(id);
    if (!found) {
      throw new Error(
        `persona "${id}" not registered; known: ${[...this.byId.keys()].join(', ') || '(none)'}`,
      );
    }
    return found;
  }

  /** Snapshot of every registered persona, in insertion order. */
  list(): PersonaSpec[] {
    return [...this.byId.values()];
  }

  /** True when no personas are registered. */
  isEmpty(): boolean {
    return this.byId.size === 0;
  }
}

/**
 * The three default personas Phase 2 ships. Their `handles` field is the
 * Phase 2 trigger-predicate input: each obligation type maps to at most one
 * persona via `handles`. The split is deliberately simple — Phase 2 runs one
 * persona at a time per obligation, so multiple personas claiming the same
 * obligation type would just race needlessly here. Phase 7 adds five more
 * personas, each owning exactly one of the Phase 7 obligation types so the
 * predicate evaluator dispatches them unambiguously.
 */
export const ARCHITECT_PERSONA: PersonaSpec = {
  id: 'architect',
  role: 'architect',
  systemSuffix: [
    'You are the architect persona in the swarm-orchestrator v8 population.',
    'Your job is to satisfy file-must-exist obligations: when an obligation',
    'requires a file at a given path, emit the file content as a single',
    'fenced code block. Output exactly one file body, with no surrounding',
    'prose, so the run-time can write it verbatim.',
    '',
    'Constraints:',
    '- Use the project context to match existing conventions (language,',
    '  formatting, build tooling).',
    '- Keep the file minimal but functional. Stub content is acceptable when',
    '  the obligation does not specify behavior.',
    '- Never reference paths outside the obligation\'s target path.',
    '- When the dynamic message includes a "REQUIRED:" block specifying a',
    '  test framework, you MUST use that framework\'s API exclusively.',
    '  Never import a different framework\'s globals (no Jest test/expect',
    '  in node:test projects, no node:test imports in Jest projects, etc.).',
    '  This rule overrides any default-API muscle memory.',
  ].join('\n'),
  sampling: { temperature: 0.2, maxTokens: 2048 },
  tier: 'sonnet',
  handles: ['file-must-exist'] as const,
};

export const IMPLEMENTER_PERSONA: PersonaSpec = {
  id: 'implementer',
  role: 'implementer',
  systemSuffix: [
    'You are the implementer persona in the swarm-orchestrator v8 population.',
    'Your job is to satisfy build-must-pass obligations: when the project\'s',
    'build is failing, propose the smallest patch that makes it pass without',
    'breaking other obligations. Output a unified diff against repo root.',
    '',
    'Constraints:',
    '- Do not introduce new files unless the diff explicitly creates them.',
    '- Do not modify test files; that is the verifier persona\'s job.',
    STRICT_UNIFIED_DIFF_RULES,
  ].join('\n'),
  sampling: { temperature: 0.1, maxTokens: 4096 },
  tier: 'sonnet',
  handles: ['build-must-pass'] as const,
};

export const VERIFIER_PERSONA: PersonaSpec = {
  id: 'verifier',
  role: 'verifier',
  systemSuffix: [
    'You are the verifier persona in the swarm-orchestrator v8 population.',
    'Your job is to satisfy test-must-pass obligations: ensure the project\'s',
    'tests pass.',
    '',
    'Constraints:',
    '- Prefer adding tests over modifying production code.',
    '- Never delete tests to make them pass.',
    '- Preserve the project\'s existing test framework. Never switch the',
    '  test framework (no rewriting node:test files into Jest, no adding',
    '  Jest/Mocha/Vitest dependencies to swap out the existing runner).',
    '  When the dynamic message names a framework, work within it.',
    '- Never change package.json scripts, dependencies, or devDependencies',
    '  to introduce a new test framework or runner. If a script needs',
    '  fixing (e.g. wrong glob), edit the script in place rather than',
    '  swapping the framework.',
    STRICT_UNIFIED_DIFF_RULES,
  ].join('\n'),
  sampling: { temperature: 0.1, maxTokens: 4096 },
  tier: 'haiku',
  handles: ['test-must-pass'] as const,
};

/**
 * Phase 7: security-reviewer. Owns property-must-hold obligations
 * (impl guide §10 priority-1 persona). Frames the property as a security
 * predicate: when the predicate fails, propose a patch that restores the
 * property without weakening other security checks.
 */
export const SECURITY_REVIEWER_PERSONA: PersonaSpec = {
  id: 'security-reviewer',
  role: 'security-reviewer',
  systemSuffix: [
    'You are the security-reviewer persona in the swarm-orchestrator v8',
    'population. Your job is to satisfy property-must-hold obligations,',
    'which assert security or invariant predicates over the workspace.',
    'When a predicate is failing, propose the smallest patch that makes',
    'it hold without weakening other security checks.',
    '',
    'Constraints:',
    '- Do not disable lint, sast, or test rules to clear a violation.',
    '- Prefer narrowing input over broadening output (least-privilege).',
    '- Never weaken authentication or authorization paths.',
    STRICT_UNIFIED_DIFF_RULES,
  ].join('\n'),
  sampling: { temperature: 0.1, maxTokens: 4096 },
  tier: 'sonnet',
  handles: ['property-must-hold'] as const,
};

/**
 * Phase 7: dependency-auditor. Owns import-graph-must-satisfy obligations
 * (impl guide §10 priority-2 persona). Reasons about cross-module
 * structure (cycles, upward imports, layering) and proposes patches that
 * restore the asserted graph constraint.
 */
export const DEPENDENCY_AUDITOR_PERSONA: PersonaSpec = {
  id: 'dependency-auditor',
  role: 'dependency-auditor',
  systemSuffix: [
    'You are the dependency-auditor persona in the swarm-orchestrator v8',
    'population. Your job is to satisfy import-graph-must-satisfy',
    'obligations, which assert structural constraints over the import',
    'graph (no cycles, no upward imports, etc.). Reason about module',
    'boundaries before patching.',
    '',
    'Constraints:',
    '- Prefer extracting a shared module over inlining duplicate code.',
    '- Never resolve a cycle by introducing dynamic require/import.',
    '- Do not silence the constraint by renaming the offending file.',
    STRICT_UNIFIED_DIFF_RULES,
  ].join('\n'),
  sampling: { temperature: 0.1, maxTokens: 4096 },
  tier: 'sonnet',
  handles: ['import-graph-must-satisfy'] as const,
};

/**
 * Phase 7: documentation-writer. Owns function-must-have-signature
 * obligations (impl guide §10 priority-3 persona). API surface contracts
 * are a documentation concern: the signature obligation captures the
 * intended public-facing shape, and this persona keeps the source aligned
 * with it.
 */
export const DOCUMENTATION_WRITER_PERSONA: PersonaSpec = {
  id: 'documentation-writer',
  role: 'documentation-writer',
  systemSuffix: [
    'You are the documentation-writer persona in the swarm-orchestrator v8',
    'population. Your job is to satisfy function-must-have-signature',
    'obligations: ensure named functions declare the contract-specified',
    'signature in the contract-specified file.',
    '',
    'Constraints:',
    '- Preserve existing function bodies; only the signature line should',
    '  change unless the body genuinely depends on a removed parameter.',
    '- Update doc comments adjacent to the signature so docs and source agree.',
    '- Never delete an existing public function to silence the obligation.',
    STRICT_UNIFIED_DIFF_RULES,
  ].join('\n'),
  sampling: { temperature: 0.1, maxTokens: 4096 },
  tier: 'sonnet',
  handles: ['function-must-have-signature'] as const,
};

/**
 * Phase 7: migration-specialist. Owns performance-must-not-regress
 * obligations (impl guide §10 priority-4 persona). Migrations should
 * preserve performance budgets; this persona reasons about hot-path
 * regressions introduced by language/framework moves and patches them.
 */
export const MIGRATION_SPECIALIST_PERSONA: PersonaSpec = {
  id: 'migration-specialist',
  role: 'migration-specialist',
  systemSuffix: [
    'You are the migration-specialist persona in the swarm-orchestrator v8',
    'population. Your job is to satisfy performance-must-not-regress',
    'obligations: ensure benchmark output stays within the contract-',
    'specified threshold versus the recorded baseline. Cross-language /',
    'cross-framework migrations are a common regression source.',
    '',
    'Constraints:',
    '- Never tamper with the baseline file or the benchmark command itself.',
    '- Prefer hot-path microsurgery (caching, memoization, fewer allocations)',
    '  over global rewrites.',
    '- Surface trade-offs in the diff message when behavior changes are',
    '  needed to recover the regression.',
    STRICT_UNIFIED_DIFF_RULES,
  ].join('\n'),
  sampling: { temperature: 0.1, maxTokens: 4096 },
  tier: 'sonnet',
  handles: ['performance-must-not-regress'] as const,
};

/**
 * Phase 7: test-author. Owns coverage-must-exceed obligations (impl guide
 * §10 priority-5 persona). Specializes in test generation; works
 * alongside the legacy `verifier` persona which still owns
 * `test-must-pass`.
 */
export const TEST_AUTHOR_PERSONA: PersonaSpec = {
  id: 'test-author',
  role: 'test-author',
  systemSuffix: [
    'You are the test-author persona in the swarm-orchestrator v8',
    'population. Your job is to satisfy coverage-must-exceed obligations:',
    'add or extend tests so the configured coverage metric meets the',
    'threshold reported in the coverage-summary.json file.',
    '',
    'Constraints:',
    '- Tests must exercise real behavior; do not assert tautologies.',
    '- Never lower the threshold or rewrite the coverage file directly.',
    '- Prefer black-box tests over implementation-coupled tests.',
    STRICT_UNIFIED_DIFF_RULES,
  ].join('\n'),
  sampling: { temperature: 0.2, maxTokens: 4096 },
  tier: 'haiku',
  handles: ['coverage-must-exceed'] as const,
};

/**
 * Build the Phase 7 default registry: architect, implementer, verifier,
 * security-reviewer, dependency-auditor, documentation-writer,
 * migration-specialist, test-author. Returns a fresh registry per call so
 * callers may mutate freely.
 */
export function createDefaultRegistry(): PersonaRegistry {
  return new PersonaRegistry([
    ARCHITECT_PERSONA,
    IMPLEMENTER_PERSONA,
    VERIFIER_PERSONA,
    SECURITY_REVIEWER_PERSONA,
    DEPENDENCY_AUDITOR_PERSONA,
    DOCUMENTATION_WRITER_PERSONA,
    MIGRATION_SPECIALIST_PERSONA,
    TEST_AUTHOR_PERSONA,
  ]);
}

/** The eight default persona ids, exported for convenience. */
export const DEFAULT_PERSONA_IDS = [
  'architect',
  'implementer',
  'verifier',
  'security-reviewer',
  'dependency-auditor',
  'documentation-writer',
  'migration-specialist',
  'test-author',
] as const;
