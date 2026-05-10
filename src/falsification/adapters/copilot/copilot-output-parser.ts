/**
 * Parses the JSON candidate document Copilot emits in response to the
 * adversarial-perturbation prompt. Strict by design — malformed output is
 * a real error, not a `no-falsification-found` outcome. Mirrors the
 * Codex parser's brace-balanced fenced-JSON scanner so embedded
 * triple-backticks inside `bytes` fields cannot break extraction.
 */

import { COPILOT_CANDIDATE_COUNT } from './copilot-prompt';

/** A single parsed candidate. Shape matches `buildCopilotPrompt`'s schema. */
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
 * Parse Copilot's stdout and return the candidate list. Throws on:
 * - missing fenced JSON block
 * - JSON parse failure
 * - schema mismatch
 * - candidate count != COPILOT_CANDIDATE_COUNT
 */
export function parseCopilotCandidates(rawOutput: string): readonly ParsedCandidate[] {
  const jsonText = extractFencedJson(rawOutput);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (cause) {
    throw new Error(
      `Copilot output contained a fenced \`\`\`json\`\`\` block but it did not parse as JSON. ` +
        `Inspect captured stdout to debug the prompt; do not auto-retry — the prompt may need a strategy iteration.`,
      { cause },
    );
  }
  return validateCandidates(parsed);
}

function extractFencedJson(rawOutput: string): string {
  const FENCE_START = '```json';
  const fenceIdx = rawOutput.indexOf(FENCE_START);
  if (fenceIdx === -1) {
    throw new Error(
      'Copilot output did not contain a fenced ```json``` block. The prompt asks for one and ' +
        'no other content; this means either the prompt failed to constrain the model or the ' +
        'Copilot CLI changed its output framing. Inspect captured stdout and update the strategy.',
    );
  }
  const after = rawOutput.slice(fenceIdx + FENCE_START.length);
  let i = 0;
  while (i < after.length && /\s/.test(after[i] as string)) i += 1;
  if (i >= after.length || (after[i] !== '{' && after[i] !== '[')) {
    throw new Error(
      'Copilot fenced ```json``` block did not start with `{` or `[` after the fence header. ' +
        'Inspect captured stdout to debug the prompt.',
    );
  }
  const jsonStart = i;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (; i < after.length; i += 1) {
    const ch = after[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return after.slice(jsonStart, i + 1);
      }
    }
  }
  throw new Error(
    'Copilot fenced ```json``` block had unbalanced braces. ' +
      'Inspect captured stdout — the model produced a truncated or malformed JSON document.',
  );
}

function validateCandidates(parsed: unknown): readonly ParsedCandidate[] {
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Copilot JSON root must be an object with a "candidates" array');
  }
  const root = parsed as { candidates?: unknown };
  if (!Array.isArray(root.candidates)) {
    throw new Error('Copilot JSON is missing the "candidates" array');
  }
  if (root.candidates.length !== COPILOT_CANDIDATE_COUNT) {
    throw new Error(
      `Copilot returned ${root.candidates.length} candidates; the prompt requires ` +
        `exactly ${COPILOT_CANDIDATE_COUNT}. This is a strategy regression — investigate the ` +
        `prompt or model output before re-running.`,
    );
  }
  return root.candidates.map((entry, index) => validateCandidate(entry, index));
}

function validateCandidate(entry: unknown, index: number): ParsedCandidate {
  if (entry === null || typeof entry !== 'object') {
    throw new Error(`Copilot candidate at index ${index} is not an object`);
  }
  const obj = entry as { name?: unknown; rationale?: unknown; files?: unknown };
  const name = requireNonEmptyString(obj.name, `candidate[${index}].name`);
  const rationale = requireNonEmptyString(obj.rationale, `candidate[${index}].rationale`);
  if (!Array.isArray(obj.files) || obj.files.length === 0) {
    throw new Error(`Copilot candidate "${name}" must have a non-empty files array`);
  }
  const files = obj.files.map((file, fileIndex) => validateCandidateFile(file, name, fileIndex));
  return { name, rationale, files };
}

function validateCandidateFile(
  entry: unknown,
  candidateName: string,
  fileIndex: number,
): ParsedCandidateFile {
  if (entry === null || typeof entry !== 'object') {
    throw new Error(
      `Copilot candidate "${candidateName}" file[${fileIndex}] is not an object`,
    );
  }
  const obj = entry as { relPath?: unknown; bytes?: unknown };
  const relPath = requireNonEmptyString(
    obj.relPath,
    `candidate "${candidateName}" file[${fileIndex}].relPath`,
  );
  const bytes = requireStringAllowEmpty(
    obj.bytes,
    `candidate "${candidateName}" file[${fileIndex}].bytes`,
  );
  if (relPath.startsWith('/') || relPath.includes('..')) {
    throw new Error(
      `Copilot candidate "${candidateName}" file[${fileIndex}] relPath "${relPath}" must be ` +
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
