import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { OBLIGATION_TYPES, type ObligationType } from '../contract/types';
import type { ModelTier, PersonaSpec } from './types';

const VALID_TIERS: readonly ModelTier[] = ['haiku', 'sonnet', 'opus'];
const OBLIGATION_TYPE_SET: ReadonlySet<string> = new Set(OBLIGATION_TYPES);

/**
 * Walk up from this file until a `config/personas/` directory is found. The
 * compiled output lives at `dist/src/persona/persona-registry.js`, so the
 * resolve has to traverse out of `dist/`; running under ts-node the layout
 * starts one level shallower. Either way the package root is where
 * `config/personas/` actually lives.
 */
function findPersonasDir(): string {
  let current = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(current, 'config', 'personas');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`persona-registry: cannot locate config/personas/ from ${__dirname}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown, where: string): string {
  if (typeof v !== 'string') {
    throw new Error(`persona-registry: ${where} must be a string`);
  }
  return v;
}

function asNumber(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`persona-registry: ${where} must be a finite number`);
  }
  return v;
}

function parsePersonaYaml(file: string): PersonaSpec {
  const text = fs.readFileSync(file, 'utf8');
  const raw: unknown = yaml.load(text);
  if (!isRecord(raw)) {
    throw new Error(`persona-registry: ${file} must be a YAML mapping`);
  }
  const sampling = raw.sampling;
  if (!isRecord(sampling)) {
    throw new Error(`persona-registry: ${file} missing 'sampling' mapping`);
  }
  const tier = asString(raw.tier, `${file}: tier`);
  if (!(VALID_TIERS as readonly string[]).includes(tier)) {
    throw new Error(
      `persona-registry: ${file}: tier '${tier}' must be one of ${VALID_TIERS.join(', ')}`,
    );
  }
  const handles = raw.handles;
  if (!Array.isArray(handles) || handles.length === 0) {
    throw new Error(`persona-registry: ${file}: handles must be a non-empty array`);
  }
  for (const h of handles) {
    if (typeof h !== 'string' || !OBLIGATION_TYPE_SET.has(h)) {
      throw new Error(
        `persona-registry: ${file}: handles entry '${String(h)}' is not a known ObligationType`,
      );
    }
  }
  const temperature = asNumber(sampling.temperature, `${file}: sampling.temperature`);
  const maxTokens = asNumber(sampling.maxTokens, `${file}: sampling.maxTokens`);
  const topP =
    sampling.topP === undefined ? undefined : asNumber(sampling.topP, `${file}: sampling.topP`);
  return {
    id: asString(raw.id, `${file}: id`),
    role: asString(raw.role, `${file}: role`),
    systemSuffix: asString(raw.systemSuffix, `${file}: systemSuffix`),
    sampling: { temperature, maxTokens, ...(topP !== undefined ? { topP } : {}) },
    tier: tier as ModelTier,
    handles: handles as readonly ObligationType[],
  };
}

const PERSONAS_DIR = findPersonasDir();

function loadPersona(id: string): PersonaSpec {
  return parsePersonaYaml(path.join(PERSONAS_DIR, `${id}.yaml`));
}

/**
 * Registry of persona specs. The eight default personas are loaded eagerly
 * from `config/personas/*.yaml` at module-init time. The registry itself is
 * a pure in-memory key/value store; persistence happens in the ledger and
 * the contract, not here.
 */
export class PersonaRegistry {
  private readonly byId: Map<string, PersonaSpec>;

  constructor(initial: readonly PersonaSpec[] = []) {
    this.byId = new Map();
    for (const p of initial) this.register(p);
  }

  register(spec: PersonaSpec): void {
    if (this.byId.has(spec.id)) {
      throw new Error(
        `persona "${spec.id}" already registered; use replace() for explicit overwrite`,
      );
    }
    this.byId.set(spec.id, spec);
  }

  replace(spec: PersonaSpec): void {
    this.byId.set(spec.id, spec);
  }

  get(id: string): PersonaSpec | null {
    return this.byId.get(id) ?? null;
  }

  require(id: string): PersonaSpec {
    const found = this.byId.get(id);
    if (!found) {
      throw new Error(
        `persona "${id}" not registered; known: ${[...this.byId.keys()].join(', ') || '(none)'}`,
      );
    }
    return found;
  }

  list(): PersonaSpec[] {
    return [...this.byId.values()];
  }

  isEmpty(): boolean {
    return this.byId.size === 0;
  }
}

export const ARCHITECT_PERSONA: PersonaSpec = loadPersona('architect');
export const IMPLEMENTER_PERSONA: PersonaSpec = loadPersona('implementer');
export const VERIFIER_PERSONA: PersonaSpec = loadPersona('verifier');
export const SECURITY_REVIEWER_PERSONA: PersonaSpec = loadPersona('security-reviewer');
export const DEPENDENCY_AUDITOR_PERSONA: PersonaSpec = loadPersona('dependency-auditor');
export const DOCUMENTATION_WRITER_PERSONA: PersonaSpec = loadPersona('documentation-writer');
export const MIGRATION_SPECIALIST_PERSONA: PersonaSpec = loadPersona('migration-specialist');
export const TEST_AUTHOR_PERSONA: PersonaSpec = loadPersona('test-author');

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
