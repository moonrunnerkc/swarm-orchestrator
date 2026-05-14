// Brace-balanced fenced-JSON extractor + candidate validator shared
// by every adapter whose prompt mandates a single fenced ```json```
// block. The extractor is string-aware so embedded triple-backticks
// inside `bytes` cannot truncate the document (codex tests pin this).
// Strict by design — malformed output is a real error worth surfacing.

import type { ParsedCandidate, ParsedCandidateFile } from './cli-falsifier';

export interface FencedJsonParserConfig {
  readonly label: string;
  readonly requiredCount: number;
}

/** Extract and validate the fenced JSON candidate document from `rawOutput`. */
export function parseFencedCandidates(
  rawOutput: string,
  config: FencedJsonParserConfig,
): readonly ParsedCandidate[] {
  const jsonText = extractFencedJson(rawOutput, config.label);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (cause) {
    throw new Error(
      `${config.label} output: fenced \`\`\`json\`\`\` block did not parse as JSON. ` +
        `Inspect captured stdout to debug the prompt.`,
      { cause },
    );
  }
  return validateCandidates(parsed, config);
}

function extractFencedJson(rawOutput: string, label: string): string {
  const FENCE = '```json';
  const fenceIdx = rawOutput.indexOf(FENCE);
  if (fenceIdx === -1) {
    throw new Error(
      `${label} output did not contain a fenced \`\`\`json\`\`\` block. Inspect captured stdout.`,
    );
  }
  const after = rawOutput.slice(fenceIdx + FENCE.length);
  let i = 0;
  while (i < after.length && /\s/.test(after[i] as string)) i += 1;
  if (i >= after.length || (after[i] !== '{' && after[i] !== '[')) {
    throw new Error(`${label} fenced \`\`\`json\`\`\` block did not start with \`{\` or \`[\`.`);
  }
  const start = i;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (; i < after.length; i += 1) {
    const ch = after[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return after.slice(start, i + 1);
    }
  }
  throw new Error(`${label} fenced \`\`\`json\`\`\` block had unbalanced braces.`);
}

function validateCandidates(parsed: unknown, config: FencedJsonParserConfig): readonly ParsedCandidate[] {
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`${config.label} JSON root must be an object with a "candidates" array`);
  }
  const root = parsed as { candidates?: unknown };
  if (!Array.isArray(root.candidates)) {
    throw new Error(`${config.label} JSON is missing the "candidates" array`);
  }
  if (root.candidates.length !== config.requiredCount) {
    throw new Error(
      `${config.label} returned ${root.candidates.length} candidates; expected exactly ${config.requiredCount}.`,
    );
  }
  return root.candidates.map((entry, i) => validateCandidate(entry, i, config.label));
}

function validateCandidate(entry: unknown, index: number, label: string): ParsedCandidate {
  if (entry === null || typeof entry !== 'object') {
    throw new Error(`${label} candidate at index ${index} is not an object`);
  }
  const obj = entry as { name?: unknown; rationale?: unknown; files?: unknown };
  const name = requireNonEmpty(obj.name, `candidate[${index}].name`);
  const rationale = requireNonEmpty(obj.rationale, `candidate[${index}].rationale`);
  if (!Array.isArray(obj.files) || obj.files.length === 0) {
    throw new Error(`${label} candidate "${name}" must have a non-empty files array`);
  }
  const files = obj.files.map((f, j) => validateFile(f, name, j, label));
  return { name, rationale, files };
}

function validateFile(entry: unknown, candidateName: string, j: number, label: string): ParsedCandidateFile {
  if (entry === null || typeof entry !== 'object') {
    throw new Error(`${label} candidate "${candidateName}" file[${j}] is not an object`);
  }
  const obj = entry as { relPath?: unknown; bytes?: unknown };
  const relPath = requireNonEmpty(obj.relPath, `candidate "${candidateName}" file[${j}].relPath`);
  if (typeof obj.bytes !== 'string') {
    throw new Error(`candidate "${candidateName}" file[${j}].bytes must be a string`);
  }
  if (relPath.startsWith('/') || relPath.includes('..')) {
    throw new Error(
      `${label} candidate "${candidateName}" file[${j}] relPath "${relPath}" must be relative and may not contain "..".`,
    );
  }
  return { relPath, bytes: obj.bytes };
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}
