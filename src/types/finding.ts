import { createHash } from 'crypto';

export type FindingSeverity = 'high' | 'medium' | 'low';
export type FindingScope = 'line' | 'file' | 'summary';
export type FindingProducerId =
  | 'cheat-detector'
  | 'mutation-gate'
  | 'property-gate'
  | 'differential-gate';

interface FindingBase {
  id: string;
  scope: FindingScope;
  severity: FindingSeverity;
  ruleId: string;
  message: string;
  producerId: FindingProducerId;
  suggestedEdit?: string;
  evidenceUrl?: string;
}

export interface LineFinding extends FindingBase {
  scope: 'line';
  filePath: string;
  line: number;
  endLine?: number;
}

export interface FileFinding extends FindingBase {
  scope: 'file';
  filePath: string;
}

export interface SummaryFinding extends FindingBase {
  scope: 'summary';
}

export type Finding = LineFinding | FileFinding | SummaryFinding;

export type LineFindingInput = Omit<LineFinding, 'id'>;
export type FileFindingInput = Omit<FileFinding, 'id'>;
export type SummaryFindingInput = Omit<SummaryFinding, 'id'>;
export type FindingInput = LineFindingInput | FileFindingInput | SummaryFindingInput;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertMessage(message: string): void {
  if (message.trim() === '') {
    throw new Error('finding message is empty; provide one actionable sentence');
  }
  if (message.length > 200) {
    throw new Error('finding message exceeds 200 characters; shorten it to one sentence');
  }
}

function hashParts(input: FindingInput): string[] {
  if (input.scope === 'line') {
    return [input.filePath, String(input.line), input.ruleId, input.message];
  }
  if (input.scope === 'file') {
    return [input.filePath, input.scope, input.ruleId, input.message];
  }
  return [input.scope, input.producerId, input.ruleId, input.message];
}

function findingId(input: FindingInput): string {
  return createHash('sha256').update(hashParts(input).join('\0')).digest('hex');
}

function isKnownSeverity(value: unknown): value is FindingSeverity {
  return value === 'high' || value === 'medium' || value === 'low';
}

function isKnownProducer(value: unknown): value is FindingProducerId {
  return value === 'cheat-detector'
    || value === 'mutation-gate'
    || value === 'property-gate'
    || value === 'differential-gate';
}

/**
 * Create a finding with a stable content hash.
 *
 * @param input - Finding fields without the generated id.
 * @returns A normalized finding with a deterministic id.
 */
export function createFinding(input: FindingInput): Finding {
  assertMessage(input.message);
  if (input.scope === 'line' && (!Number.isInteger(input.line) || input.line < 1)) {
    throw new Error('line-scoped finding requires a positive 1-indexed line number');
  }
  if (input.scope === 'line' && input.endLine !== undefined && input.endLine < input.line) {
    throw new Error('line-scoped finding endLine cannot be before line');
  }
  return { ...input, id: findingId(input) };
}

/**
 * Check whether a value conforms to the normalized finding schema.
 *
 * @param value - Unknown value to validate.
 * @returns Whether the value is a line, file, or summary finding.
 */
export function isFinding(value: unknown): value is Finding {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (!isKnownSeverity(value.severity)) return false;
  if (!isKnownProducer(value.producerId)) return false;
  if (typeof value.ruleId !== 'string' || value.ruleId.trim() === '') return false;
  if (typeof value.message !== 'string' || value.message.trim() === '' || value.message.length > 200) {
    return false;
  }

  if (value.scope === 'line') {
    return typeof value.filePath === 'string'
      && value.filePath.trim() !== ''
      && Number.isInteger(value.line)
      && Number(value.line) > 0
      && (value.endLine === undefined
        || (Number.isInteger(value.endLine) && Number(value.endLine) >= Number(value.line)));
  }
  if (value.scope === 'file') {
    return typeof value.filePath === 'string' && value.filePath.trim() !== '';
  }
  return value.scope === 'summary';
}
