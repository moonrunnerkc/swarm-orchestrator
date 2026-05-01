import * as path from 'path';
import { createFinding, type Finding, type FindingSeverity } from '../types/finding';

function semgrepMessage(record: Record<string, unknown>): string {
  const extra = record.extra;
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    const message = (extra as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim() !== '') {
      const normalized = message.trim().replace(/\s+/g, ' ');
      return normalized.length <= 200 ? normalized : `${normalized.slice(0, 197)}...`;
    }
  }
  return 'Semgrep rule pack finding.';
}

function semgrepSeverity(record: Record<string, unknown>): FindingSeverity {
  const extra = record.extra;
  const raw = extra && typeof extra === 'object' && !Array.isArray(extra)
    ? (extra as Record<string, unknown>).severity
    : undefined;
  if (typeof raw !== 'string') return 'medium';
  const normalized = raw.toLowerCase();
  if (normalized === 'error' || normalized === 'high') return 'high';
  if (normalized === 'info' || normalized === 'low') return 'low';
  return 'medium';
}

function semgrepLine(record: Record<string, unknown>, key: 'start' | 'end'): number | undefined {
  const value = record[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const line = (value as Record<string, unknown>).line;
  return typeof line === 'number' && Number.isInteger(line) && line > 0 ? line : undefined;
}

function semgrepFinding(input: {
  ruleId: string;
  severity: FindingSeverity;
  filePath: string;
  line?: number | undefined;
  endLine?: number | undefined;
  message: string;
}): Finding {
  if (input.filePath !== 'unknown' && input.line !== undefined) {
    const lineInput = {
      scope: 'line',
      producerId: 'cheat-detector',
      ruleId: input.ruleId,
      severity: input.severity,
      filePath: input.filePath,
      line: input.line,
      message: input.message,
    } as const;
    return input.endLine !== undefined && input.endLine >= input.line
      ? createFinding({ ...lineInput, endLine: input.endLine })
      : createFinding(lineInput);
  }
  if (input.filePath !== 'unknown') {
    return createFinding({
      scope: 'file',
      producerId: 'cheat-detector',
      ruleId: input.ruleId,
      severity: input.severity,
      filePath: input.filePath,
      message: input.message,
    });
  }
  return createFinding({
    scope: 'summary',
    producerId: 'cheat-detector',
    ruleId: input.ruleId,
    severity: input.severity,
    message: input.message,
  });
}

/**
 * Normalize Semgrep JSON output into cheat-detector findings.
 *
 * @param stdout - Semgrep JSON output.
 * @param repoPath - Repository root used to relativize absolute Semgrep paths.
 * @returns Normalized findings for Semgrep results.
 */
export function normalizeSemgrepResults(stdout: string, repoPath: string): Finding[] {
  const parsed = JSON.parse(stdout) as { results?: unknown[] };
  return (parsed.results ?? []).flatMap((entry): Finding[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const rawPath = typeof record.path === 'string' ? record.path : 'unknown';
    const filePath = path.isAbsolute(rawPath) ? path.relative(repoPath, rawPath) : rawPath;
    return [semgrepFinding({
      ruleId: typeof record.check_id === 'string' ? record.check_id : 'semgrep',
      severity: semgrepSeverity(record),
      filePath,
      line: semgrepLine(record, 'start'),
      endLine: semgrepLine(record, 'end'),
      message: semgrepMessage(record),
    })];
  });
}
