import * as path from 'path';
import { obligationValidator } from './schema/loader';
import {
  type ObligationV1,
  type ObligationType,
  OBLIGATION_TYPES,
} from './types';

/**
 * Result of running the contract validator over a list of candidate
 * obligations. `errors` is empty when `valid` is true.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Single validator error. `index` references the obligation by its position
 * in the input list (0-based), or is `null` for whole-contract errors.
 */
export interface ValidationError {
  /** Index in the input list, or null for cross-obligation errors. */
  index: number | null;
  /** Stable error code for programmatic handling. */
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
  /** Human-readable message including remediation hint. */
  message: string;
}

/**
 * Validate a candidate obligation list against the v1 schema and the
 * cross-obligation consistency rules described in impl guide §4
 * ("checks the draft contract for internal consistency").
 *
 * Per §4 the validator must reject:
 * - Schema violations (handled by Ajv).
 * - Contradictory obligations (here: duplicate keyed entries per type).
 * - Obligations referencing nonexistent files unless the obligation is a
 *   creation directive — `file-must-exist` IS a creation directive in v1
 *   (post-execution check), so we do not check filesystem existence.
 *
 * The validator additionally enforces the §4 minimum-shape requirement
 * surfaced in the Phase 1 exit criteria: a draft must contain at least one
 * `test-must-pass` obligation, and at least one `build-must-pass` when the
 * caller indicates the project has a build step. Library projects published
 * as source (no `scripts.build`) pass `requireBuild: false`; forcing a
 * synthetic `npm run build` against a repo with no build script generates
 * a phantom obligation that can never satisfy.
 *
 * Phase 7 extends per-type duplicate-detection to the five new types
 * (impl guide §10). Each type's identity key is the canonical payload
 * tuple; duplicates are flagged with a type-specific error code so the
 * CLI can show targeted remediation.
 */
export interface ValidateOptions {
  /**
   * When false, contracts without a `build-must-pass` obligation are
   * accepted. Used by `compileGoal`/`finalize` when the project's
   * discovered `repoContext.buildCommand` is null (no build step exists).
   * Defaults to true to preserve historical behavior.
   */
  requireBuild?: boolean;
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

  const seenPaths = new Set<string>();
  const seenBuildCommands = new Set<string>();
  const seenTestCommands = new Set<string>();
  const seenSignatureKeys = new Set<string>();
  const seenPropertyKeys = new Set<string>();
  const seenImportGraphKeys = new Set<string>();
  const seenCoverageKeys = new Set<string>();
  const seenPerfKeys = new Set<string>();
  let hasBuild = false;
  let hasTest = false;

  for (let i = 0; i < candidates.length; i += 1) {
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

    switch (obligation.type) {
      case 'file-must-exist': {
        const checkErr = checkPath(obligation.path, i);
        if (checkErr) {
          errors.push(checkErr);
          break;
        }
        if (seenPaths.has(obligation.path)) {
          errors.push({
            index: i,
            code: 'duplicate-file-must-exist',
            message: `duplicate file-must-exist for path "${obligation.path}"; remove the redundant entry`,
          });
          break;
        }
        seenPaths.add(obligation.path);
        break;
      }
      case 'build-must-pass': {
        const cmdErr = checkCommand(obligation.command, i);
        if (cmdErr) {
          errors.push(cmdErr);
          break;
        }
        if (seenBuildCommands.has(obligation.command)) {
          errors.push({
            index: i,
            code: 'duplicate-build-must-pass',
            message: `duplicate build-must-pass for command "${obligation.command}"; remove the redundant entry`,
          });
          break;
        }
        seenBuildCommands.add(obligation.command);
        hasBuild = true;
        break;
      }
      case 'test-must-pass': {
        const cmdErr = checkCommand(obligation.command, i);
        if (cmdErr) {
          errors.push(cmdErr);
          break;
        }
        if (seenTestCommands.has(obligation.command)) {
          errors.push({
            index: i,
            code: 'duplicate-test-must-pass',
            message: `duplicate test-must-pass for command "${obligation.command}"; remove the redundant entry`,
          });
          break;
        }
        seenTestCommands.add(obligation.command);
        hasTest = true;
        break;
      }
      case 'function-must-have-signature': {
        const fileErr = checkPath(obligation.file, i);
        if (fileErr) {
          errors.push(fileErr);
          break;
        }
        if (obligation.name.trim().length === 0) {
          errors.push({
            index: i,
            code: 'empty-field',
            message: `obligation ${i} has empty name`,
          });
          break;
        }
        if (obligation.signature.trim().length === 0) {
          errors.push({
            index: i,
            code: 'empty-field',
            message: `obligation ${i} has empty signature`,
          });
          break;
        }
        const key = `${obligation.file}|${obligation.name}|${obligation.signature}`;
        if (seenSignatureKeys.has(key)) {
          errors.push({
            index: i,
            code: 'duplicate-function-must-have-signature',
            message: `duplicate function-must-have-signature for ${obligation.file}:${obligation.name}; remove the redundant entry`,
          });
          break;
        }
        seenSignatureKeys.add(key);
        break;
      }
      case 'property-must-hold': {
        const cmdErr = checkCommand(obligation.predicate, i);
        if (cmdErr) {
          errors.push(cmdErr);
          break;
        }
        if (obligation.target.trim().length === 0) {
          errors.push({
            index: i,
            code: 'empty-field',
            message: `obligation ${i} has empty target`,
          });
          break;
        }
        const key = `${obligation.target}|${obligation.predicate}`;
        if (seenPropertyKeys.has(key)) {
          errors.push({
            index: i,
            code: 'duplicate-property-must-hold',
            message: `duplicate property-must-hold for target "${obligation.target}"; remove the redundant entry`,
          });
          break;
        }
        seenPropertyKeys.add(key);
        break;
      }
      case 'import-graph-must-satisfy': {
        const scopeErr = checkPath(obligation.scope, i);
        if (scopeErr) {
          errors.push(scopeErr);
          break;
        }
        const key = `${obligation.scope}|${obligation.constraint}`;
        if (seenImportGraphKeys.has(key)) {
          errors.push({
            index: i,
            code: 'duplicate-import-graph-must-satisfy',
            message: `duplicate import-graph-must-satisfy for scope "${obligation.scope}" / constraint "${obligation.constraint}"; remove the redundant entry`,
          });
          break;
        }
        seenImportGraphKeys.add(key);
        break;
      }
      case 'coverage-must-exceed': {
        const scopeErr = checkPath(obligation.scope, i);
        if (scopeErr) {
          errors.push(scopeErr);
          break;
        }
        const key = `${obligation.scope}|${obligation.metric}`;
        if (seenCoverageKeys.has(key)) {
          errors.push({
            index: i,
            code: 'duplicate-coverage-must-exceed',
            message: `duplicate coverage-must-exceed for scope "${obligation.scope}" / metric "${obligation.metric}"; remove the redundant entry`,
          });
          break;
        }
        seenCoverageKeys.add(key);
        break;
      }
      case 'performance-must-not-regress': {
        const cmdErr = checkCommand(obligation.benchmark, i);
        if (cmdErr) {
          errors.push(cmdErr);
          break;
        }
        const baselineErr = checkPath(obligation.baseline, i);
        if (baselineErr) {
          errors.push(baselineErr);
          break;
        }
        const key = `${obligation.benchmark}|${obligation.baseline}`;
        if (seenPerfKeys.has(key)) {
          errors.push({
            index: i,
            code: 'duplicate-performance-must-not-regress',
            message: `duplicate performance-must-not-regress for benchmark "${obligation.benchmark}" / baseline "${obligation.baseline}"; remove the redundant entry`,
          });
          break;
        }
        seenPerfKeys.add(key);
        break;
      }
    }
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
