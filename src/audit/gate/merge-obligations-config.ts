// Loader for the optional .swarm/merge-obligations.yaml. A consumer lists
// additional ObligationV1 members here (coverage, property, signature,
// import-graph, and the rest) that the positive merge-safety gate appends to
// its default build/test set. The file is optional: absent means "just the
// defaults". When present but malformed, the loader returns the parse/schema
// errors rather than silently dropping the consumer's intent, so the gate can
// fail closed (a broken obligations file routes the PR to HUMAN, never a
// vacuous AUTO-MERGE).
//
// Reuse, not reimplementation: parsing is js-yaml (the project's contract
// YAML library) and per-obligation validation is the contract's own compiled
// obligation schema (obligationValidator), so a merge obligation is validated
// exactly as a contract obligation is.

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { obligationValidator } from '../../contract/schema/loader';
import type { ObligationV1 } from '../../shared-types/obligation-types';

const CONFIG_FILE = path.join('.swarm', 'merge-obligations.yaml');

export interface MergeObligationsResult {
  /** Valid obligations parsed from the file (empty when absent or fully invalid). */
  readonly obligations: readonly ObligationV1[];
  /** Whether the file exists on disk. */
  readonly present: boolean;
  /** Parse / schema errors. Non-empty means the file was present but malformed; the caller fails closed. */
  readonly errors: readonly string[];
}

function extractObligationsList(doc: unknown): unknown[] | null {
  if (Array.isArray(doc)) return doc;
  if (doc !== null && typeof doc === 'object' && 'obligations' in doc) {
    const value = (doc as { obligations: unknown }).obligations;
    if (Array.isArray(value)) return value;
  }
  return null;
}

/**
 * Load consumer-declared merge-safety obligations from
 * `.swarm/merge-obligations.yaml` under repoRoot.
 *
 * @param repoRoot the consumer repository root.
 * @returns the valid obligations, whether the file was present, and any
 *   parse/schema errors. An absent file is not an error; a malformed one is.
 */
export function loadMergeObligations(repoRoot: string): MergeObligationsResult {
  const file = path.join(repoRoot, CONFIG_FILE);
  if (!fs.existsSync(file)) {
    return { obligations: [], present: false, errors: [] };
  }

  let doc: unknown;
  try {
    doc = yaml.load(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { obligations: [], present: true, errors: [`${CONFIG_FILE} is not valid YAML: ${message}`] };
  }

  // An empty file (yaml.load returns undefined) is treated as "no extra obligations".
  if (doc === undefined || doc === null) {
    return { obligations: [], present: true, errors: [] };
  }

  const list = extractObligationsList(doc);
  if (list === null) {
    return {
      obligations: [],
      present: true,
      errors: [
        `${CONFIG_FILE} must contain an "obligations:" list of merge-safety obligations ` +
          '(or a top-level YAML list); add at least one obligation or delete the file',
      ],
    };
  }

  const validate = obligationValidator();
  const obligations: ObligationV1[] = [];
  const errors: string[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const candidate = list[i];
    if (validate(candidate)) {
      obligations.push(candidate as ObligationV1);
    } else {
      const detail = (validate.errors ?? [])
        .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim())
        .join('; ');
      errors.push(`obligation ${i} in ${CONFIG_FILE} failed schema: ${detail || 'unknown reason'}`);
    }
  }
  return { obligations, present: true, errors };
}
