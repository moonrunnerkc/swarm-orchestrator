/**
 * Parses the JSON candidate document Codex emits in response to the
 * adversarial-test-input prompt. Strict by design — malformed output is a
 * real error, not a `no-falsification-found` outcome. The dispatcher's
 * job is to surface real errors; collapsing parse failures into "no
 * falsification" would hide regressions in the prompt or the Codex CLI.
 */

import { CODEX_CANDIDATE_COUNT } from './codex-prompt';

/** A single parsed candidate. Shape matches `buildCodexPrompt`'s schema. */
export interface ParsedCandidate {
  readonly name: string;
  readonly rationale: string;
  readonly files: readonly ParsedCandidateFile[];
}

export interface ParsedCandidateFile {
  readonly relPath: string;
  readonly bytes: string;
}

/**
 * Parse Codex's stdout and return the candidate list. Throws on:
 * - missing fenced JSON block
 * - JSON parse failure
 * - schema mismatch
 * - candidate count != CODEX_CANDIDATE_COUNT (the prompt requires exactly
 *   that many; a different count is a model-side regression worth
 *   surfacing rather than silently accepting)
 */
export function parseCodexCandidates(rawOutput: string): readonly ParsedCandidate[] {
  const jsonText = extractFencedJson(rawOutput);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (cause) {
    throw new Error(
      `Codex output contained a fenced \`\`\`json\`\`\` block but it did not parse as JSON. ` +
        `Inspect captured stdout to debug the prompt; do not auto-retry — the prompt may need a strategy iteration.`,
      { cause },
    );
  }
  return validateCandidates(parsed);
}

function extractFencedJson(rawOutput: string): string {
  const fenceRegex = /```json\s*([\s\S]*?)```/;
  const match = fenceRegex.exec(rawOutput);
  if (match === null || typeof match[1] !== 'string') {
    throw new Error(
      'Codex output did not contain a fenced ```json``` block. The prompt asks for one and ' +
        'no other content; this means either the prompt failed to constrain the model or the ' +
        'Codex CLI changed its output framing. Inspect captured stdout and update the strategy.',
    );
  }
  return match[1].trim();
}

function validateCandidates(parsed: unknown): readonly ParsedCandidate[] {
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Codex JSON root must be an object with a "candidates" array');
  }
  const root = parsed as { candidates?: unknown };
  if (!Array.isArray(root.candidates)) {
    throw new Error('Codex JSON is missing the "candidates" array');
  }
  if (root.candidates.length !== CODEX_CANDIDATE_COUNT) {
    throw new Error(
      `Codex returned ${root.candidates.length} candidates; the prompt requires ` +
        `exactly ${CODEX_CANDIDATE_COUNT}. This is a strategy regression — investigate the ` +
        `prompt or model output before re-running.`,
    );
  }
  return root.candidates.map((entry, index) => validateCandidate(entry, index));
}

function validateCandidate(entry: unknown, index: number): ParsedCandidate {
  if (entry === null || typeof entry !== 'object') {
    throw new Error(`Codex candidate at index ${index} is not an object`);
  }
  const obj = entry as { name?: unknown; rationale?: unknown; files?: unknown };
  const name = requireNonEmptyString(obj.name, `candidate[${index}].name`);
  const rationale = requireNonEmptyString(obj.rationale, `candidate[${index}].rationale`);
  if (!Array.isArray(obj.files) || obj.files.length === 0) {
    throw new Error(`Codex candidate "${name}" must have a non-empty files array`);
  }
  const files = obj.files.map((file, fileIndex) =>
    validateCandidateFile(file, name, fileIndex),
  );
  return { name, rationale, files };
}

function validateCandidateFile(
  entry: unknown,
  candidateName: string,
  fileIndex: number,
): ParsedCandidateFile {
  if (entry === null || typeof entry !== 'object') {
    throw new Error(
      `Codex candidate "${candidateName}" file[${fileIndex}] is not an object`,
    );
  }
  const obj = entry as { relPath?: unknown; bytes?: unknown };
  const relPath = requireNonEmptyString(
    obj.relPath,
    `candidate "${candidateName}" file[${fileIndex}].relPath`,
  );
  // Empty `bytes` is valid: an empty file at a forbidden path is a
  // legitimate counter-example for predicates like `find … -type f`
  // that key off path/shape, not content. The earlier non-empty check
  // here rejected codex's "empty .env" candidate even though the
  // resulting file would still falsify the predicate.
  const bytes = requireStringAllowEmpty(
    obj.bytes,
    `candidate "${candidateName}" file[${fileIndex}].bytes`,
  );
  if (relPath.startsWith('/') || relPath.includes('..')) {
    throw new Error(
      `Codex candidate "${candidateName}" file[${fileIndex}] relPath "${relPath}" must be ` +
        `relative and may not contain ".."; reject the candidate to keep the workspace contained.`,
    );
  }
  return { relPath, bytes };
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireStringAllowEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  return value;
}
