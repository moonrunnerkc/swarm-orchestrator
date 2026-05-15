import * as path from 'path';
import { obligationValidator } from './schema/loader';
import {
  type ObligationV1,
  type ObligationType,
  OBLIGATION_TYPES,
} from './types';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  // null for cross-obligation errors.
  index: number | null;
  code:
    | 'schema'
    | 'unknown-type'
    | 'absolute-path'
    | 'empty-path'
    | 'empty-command'
    | 'empty-field'
    | 'duplicate-file-must-exist'
    | 'duplicate-build-must-pass'
    | 'duplicate-test-must-pass'
    | 'duplicate-function-must-have-signature'
    | 'duplicate-property-must-hold'
    | 'duplicate-import-graph-must-satisfy'
    | 'duplicate-coverage-must-exceed'
    | 'duplicate-performance-must-not-regress'
    | 'no-obligations'
    | 'missing-build-must-pass'
    | 'missing-test-must-pass';
  message: string;
}

export interface ValidateOptions {
  // When false, contracts without a `build-must-pass` are accepted —
  // library projects published as source (no scripts.build) need this;
  // forcing a synthetic `npm run build` against such a repo generates
  // a phantom obligation that can never satisfy.
  requireBuild?: boolean;
}

// Per-type field-validation table. The order in each row is the order
// the original switch enforced — preserved so errors fire in the same
// order on the same input.
type FieldKind = 'path' | 'command' | 'nonempty-string';
type EmptyFieldName = 'name' | 'signature' | 'target';
const OBLIGATION_FIELD_CHECKS: Record<
  ObligationType,
  ReadonlyArray<{ kind: FieldKind; field: string }>
> = {
  'file-must-exist': [{ kind: 'path', field: 'path' }],
  'build-must-pass': [{ kind: 'command', field: 'command' }],
  'test-must-pass': [{ kind: 'command', field: 'command' }],
  'function-must-have-signature': [
    { kind: 'path', field: 'file' },
    { kind: 'nonempty-string', field: 'name' },
    { kind: 'nonempty-string', field: 'signature' },
  ],
  'property-must-hold': [
    { kind: 'command', field: 'predicate' },
    { kind: 'nonempty-string', field: 'target' },
  ],
  'import-graph-must-satisfy': [{ kind: 'path', field: 'scope' }],
  'coverage-must-exceed': [{ kind: 'path', field: 'scope' }],
  'performance-must-not-regress': [
    { kind: 'command', field: 'benchmark' },
    { kind: 'path', field: 'baseline' },
  ],
};

function dedupeKey(o: ObligationV1): string {
  switch (o.type) {
    case 'file-must-exist':
      return o.path;
    case 'build-must-pass':
      return o.command;
    case 'test-must-pass':
      return o.command;
    case 'function-must-have-signature':
      return `${o.file}|${o.name}|${o.signature}`;
    case 'property-must-hold':
      return `${o.target}|${o.predicate}`;
    case 'import-graph-must-satisfy':
      return `${o.scope}|${o.constraint}`;
    case 'coverage-must-exceed':
      return `${o.scope}|${o.metric}`;
    case 'performance-must-not-regress':
      return `${o.benchmark}|${o.baseline}`;
  }
}

function duplicateMessage(o: ObligationV1): string {
  switch (o.type) {
    case 'file-must-exist':
      return `duplicate file-must-exist for path "${o.path}"; remove the redundant entry`;
    case 'build-must-pass':
      return `duplicate build-must-pass for command "${o.command}"; remove the redundant entry`;
    case 'test-must-pass':
      return `duplicate test-must-pass for command "${o.command}"; remove the redundant entry`;
    case 'function-must-have-signature':
      return `duplicate function-must-have-signature for ${o.file}:${o.name}; remove the redundant entry`;
    case 'property-must-hold':
      return `duplicate property-must-hold for target "${o.target}"; remove the redundant entry`;
    case 'import-graph-must-satisfy':
      return `duplicate import-graph-must-satisfy for scope "${o.scope}" / constraint "${o.constraint}"; remove the redundant entry`;
    case 'coverage-must-exceed':
      return `duplicate coverage-must-exceed for scope "${o.scope}" / metric "${o.metric}"; remove the redundant entry`;
    case 'performance-must-not-regress':
      return `duplicate performance-must-not-regress for benchmark "${o.benchmark}" / baseline "${o.baseline}"; remove the redundant entry`;
  }
}

function duplicateCode(type: ObligationType): ValidationError['code'] {
  return `duplicate-${type}` as ValidationError['code'];
}

export function validateObligations(
  candidates: unknown[],
  options: ValidateOptions = {},
): ValidationResult {
  const errors: ValidationError[] = [];
  const validate = obligationValidator();

  if (!Array.isArray(candidates) || candidates.length === 0) {
    errors.push({
      index: null,
      code: 'no-obligations',
      message:
        'contract must contain at least one obligation; got an empty list. ' +
        'Did the goal parser extract anything?',
    });
    return { valid: false, errors };
  }

  const seenKeys: Map<ObligationType, Set<string>> = new Map();
  let hasBuild = false;
  let hasTest = false;

  outer: for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (!validate(candidate)) {
      const detail = (validate.errors ?? [])
        .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim())
        .join('; ');
      errors.push({
        index: i,
        code: 'schema',
        message: `obligation ${i} failed schema: ${detail || 'unknown reason'}`,
      });
      continue;
    }

    const obligation = candidate as ObligationV1;
    if (!isKnownType(obligation.type)) {
      errors.push({
        index: i,
        code: 'unknown-type',
        message: `obligation ${i} has unknown type "${String(obligation.type)}"; expected one of ${OBLIGATION_TYPES.join(', ')}`,
      });
      continue;
    }

    for (const check of OBLIGATION_FIELD_CHECKS[obligation.type]) {
      const value = readStringField(obligation, check.field);
      let err: ValidationError | null;
      if (check.kind === 'path') err = checkPath(value, i);
      else if (check.kind === 'command') err = checkCommand(value, i);
      else err = checkNonemptyField(value, i, check.field as EmptyFieldName);
      if (err) {
        errors.push(err);
        continue outer;
      }
    }

    let set = seenKeys.get(obligation.type);
    if (!set) {
      set = new Set();
      seenKeys.set(obligation.type, set);
    }
    const key = dedupeKey(obligation);
    if (set.has(key)) {
      errors.push({
        index: i,
        code: duplicateCode(obligation.type),
        message: duplicateMessage(obligation),
      });
      continue;
    }
    set.add(key);

    if (obligation.type === 'build-must-pass') hasBuild = true;
    else if (obligation.type === 'test-must-pass') hasTest = true;
  }

  const requireBuild = options.requireBuild ?? true;
  if (!hasBuild && requireBuild) {
    errors.push({
      index: null,
      code: 'missing-build-must-pass',
      message:
        'contract must contain at least one build-must-pass obligation. ' +
        'Add an obligation referencing the project\'s build command (e.g. "npm run build").',
    });
  }
  if (!hasTest) {
    errors.push({
      index: null,
      code: 'missing-test-must-pass',
      message:
        'contract must contain at least one test-must-pass obligation. ' +
        'Add an obligation referencing the project\'s test command (e.g. "npm test").',
    });
  }

  return { valid: errors.length === 0, errors };
}

function readStringField(o: ObligationV1, field: string): string {
  return (o as unknown as Record<string, string>)[field] ?? '';
}

function isKnownType(t: unknown): t is ObligationType {
  return typeof t === 'string' && (OBLIGATION_TYPES as readonly string[]).includes(t);
}

function checkPath(p: string, index: number): ValidationError | null {
  if (p.length === 0) {
    return {
      index,
      code: 'empty-path',
      message: `obligation ${index} has empty path`,
    };
  }
  if (path.isAbsolute(p) || /^[a-zA-Z]:[\\/]/.test(p)) {
    return {
      index,
      code: 'absolute-path',
      message: `obligation ${index} path "${p}" is absolute; paths must be relative to the repository root`,
    };
  }
  return null;
}

function checkCommand(cmd: string, index: number): ValidationError | null {
  if (cmd.trim().length === 0) {
    return {
      index,
      code: 'empty-command',
      message: `obligation ${index} has empty command`,
    };
  }
  return null;
}

function checkNonemptyField(
  value: string,
  index: number,
  field: EmptyFieldName,
): ValidationError | null {
  if (value.trim().length === 0) {
    return {
      index,
      code: 'empty-field',
      message: `obligation ${index} has empty ${field}`,
    };
  }
  return null;
}
