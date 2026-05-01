import { createFinding, type Finding, type FindingSeverity } from '../types/finding';
import { extractSourceLocations } from './source-locations';
import type { MutationGateStatus, MutationToolResult } from './mutation-gate';

function mutationSeverity(status: Exclude<MutationGateStatus, 'SKIP'>): FindingSeverity {
  return status === 'FAIL' ? 'high' : status === 'WARNING' ? 'medium' : 'low';
}

function mutationRuleId(status: Exclude<MutationGateStatus, 'SKIP'>, toolFailed: boolean): string {
  if (toolFailed) return 'mutation-tool-failed';
  if (status === 'FAIL') return 'mutation-score-fail';
  if (status === 'WARNING') return 'mutation-score-warning';
  return 'mutation-score-pass';
}

/**
 * Build mutation gate findings from mutation tool output and aggregate status.
 *
 * @param input - Tool result, repo path, aggregate status, and tool failure flag.
 * @returns Line-scoped findings when tool output includes locations, otherwise file-scoped findings.
 */
export function buildMutationFindings(input: {
  repoPath: string;
  result: Omit<MutationToolResult, 'findings'>;
  status: Exclude<MutationGateStatus, 'SKIP'>;
  toolFailed: boolean;
}): Finding[] {
  if (input.status === 'PASS' && !input.toolFailed) return [];
  const output = `${input.result.stdout}\n${input.result.stderr}`;
  const locations = extractSourceLocations(output, input.repoPath, input.result.files);
  const severity = mutationSeverity(input.status);
  const ruleId = mutationRuleId(input.status, input.toolFailed);
  const message = input.toolFailed
    ? 'Mutation tool failed before producing a mutation score.'
    : `Mutation score ${input.result.mutationScore.toFixed(3)} did not meet the configured threshold.`;

  if (locations.length > 0) {
    return locations.map(location => createFinding({
      scope: 'line',
      producerId: 'mutation-gate',
      ruleId,
      severity,
      filePath: location.filePath,
      line: location.line,
      message,
    }));
  }

  return input.result.files.map(filePath => createFinding({
    scope: 'file',
    producerId: 'mutation-gate',
    ruleId,
    severity,
    filePath,
    message,
  }));
}
