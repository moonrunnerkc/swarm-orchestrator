import type { PersonaSpec } from './types';

/**
 * Registry of persona specs. Phase 2 ships three: `architect`, `implementer`,
 * `verifier` (impl guide §5). Phase 3 expands the population to 5–7; Phase 7
 * adds security-reviewer, dependency-auditor, documentation-writer, etc.
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
 * obligation type would just race needlessly here.
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
    '- If the build is already passing, output the literal text "no-op".',
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
    'tests pass. Output one of:',
    '- A unified diff against repo root that makes tests pass.',
    '- The literal text "no-op" when tests already pass.',
    '',
    'Constraints:',
    '- Prefer adding tests over modifying production code.',
    '- Never delete tests to make them pass.',
  ].join('\n'),
  sampling: { temperature: 0.1, maxTokens: 4096 },
  tier: 'haiku',
  handles: ['test-must-pass'] as const,
};

/**
 * Build the Phase 2 default registry: architect, implementer, verifier.
 * Returns a fresh registry per call so callers may mutate freely.
 */
export function createDefaultRegistry(): PersonaRegistry {
  return new PersonaRegistry([ARCHITECT_PERSONA, IMPLEMENTER_PERSONA, VERIFIER_PERSONA]);
}

/** The three default persona ids, exported for convenience. */
export const DEFAULT_PERSONA_IDS = ['architect', 'implementer', 'verifier'] as const;
