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
    | 'duplicate-file-must-exist'
    | 'duplicate-build-must-pass'
    | 'duplicate-test-must-pass'
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
 * - Contradictory obligations (here: duplicate file paths or commands).
 * - Obligations referencing nonexistent files unless the obligation is a
 *   creation directive — `file-must-exist` IS a creation directive in v1
 *   (post-execution check), so we do not check filesystem existence.
 *
 * The validator additionally enforces the §4 minimum-shape requirement
 * surfaced in the Phase 1 exit criteria: a draft must contain at least one
 * `build-must-pass` and one `test-must-pass` obligation.
 */
export function validateObligations(candidates: unknown[]): ValidationResult {
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

    if (obligation.type === 'file-must-exist') {
      const checkErr = checkPath(obligation.path, i);
      if (checkErr) {
        errors.push(checkErr);
        continue;
      }
      if (seenPaths.has(obligation.path)) {
        errors.push({
          index: i,
          code: 'duplicate-file-must-exist',
          message: `duplicate file-must-exist for path "${obligation.path}"; remove the redundant entry`,
        });
        continue;
      }
      seenPaths.add(obligation.path);
    } else if (obligation.type === 'build-must-pass') {
      const cmdErr = checkCommand(obligation.command, i);
      if (cmdErr) {
        errors.push(cmdErr);
        continue;
      }
      if (seenBuildCommands.has(obligation.command)) {
        errors.push({
          index: i,
          code: 'duplicate-build-must-pass',
          message: `duplicate build-must-pass for command "${obligation.command}"; remove the redundant entry`,
        });
        continue;
      }
      seenBuildCommands.add(obligation.command);
      hasBuild = true;
    } else {
      // test-must-pass
      const cmdErr = checkCommand(obligation.command, i);
      if (cmdErr) {
        errors.push(cmdErr);
        continue;
      }
      if (seenTestCommands.has(obligation.command)) {
        errors.push({
          index: i,
          code: 'duplicate-test-must-pass',
          message: `duplicate test-must-pass for command "${obligation.command}"; remove the redundant entry`,
        });
        continue;
      }
      seenTestCommands.add(obligation.command);
      hasTest = true;
    }
  }

  if (!hasBuild) {
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
