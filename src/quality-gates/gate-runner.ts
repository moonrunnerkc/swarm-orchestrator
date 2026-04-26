import * as fs from 'fs';
import * as path from 'path';
import { list_project_files, maybe_read_text } from './file-utils';
import { getRegisteredGates } from './registry';
import {
    GateContext,
    GateResult,
    QualityGatesConfig
} from './types';

export interface QualityGatesRunResult {
  passed: boolean;
  advisory?: boolean;
  results: GateResult[];
  totalDurationMs: number;
}

function format_issue(issue: { message: string; filePath?: string; line?: number }): string {
  const loc = issue.filePath
    ? issue.line
      ? `${issue.filePath}:${issue.line}`
      : issue.filePath
    : 'unknown';

  return `- ${loc}: ${issue.message}`;
}

export async function run_quality_gates(
  projectRoot: string,
  config: QualityGatesConfig,
  outDir?: string,
  baselineFiles?: Set<string>,
  baseCommit?: string,
  skippedRequirementIds?: Set<string>,
  skippedGateKeys?: ReadonlySet<string>,
): Promise<QualityGatesRunResult> {
  const start = Date.now();

  if (!config.enabled) {
    return {
      passed: true,
      advisory: true,
      results: [{
        id: 'quality-gates',
        title: 'Quality gates disabled',
        status: 'skip',
        durationMs: 0,
        issues: []
      }],
      totalDurationMs: 0
    };
  }

  const files = list_project_files(projectRoot, config.excludeDirNames);

  // attach text for small-ish files once (so multiple gates can reuse)
  const ctx: GateContext = {
    projectRoot,
    files: files.map(f => {
      const text = maybe_read_text(f, config.maxFileSizeBytes);
      return text === undefined ? { ...f } : { ...f, text };
    }),
    baselineFiles,
    skippedRequirementIds,
    baseCommit,
  };

  const gateResults: GateResult[] = [];

  for (const gate of getRegisteredGates()) {
    const gateConfig = config.gates[gate.key];
    if (!gateConfig?.enabled) continue;
    // Target-mode skip: self-improvement gates the caller has opted out of
    // for this run (orchestrator passes SELF_IMPROVEMENT_GATE_KEYS when
    // targetMode === true — running against an external repo whose
    // conventions aren't ours to enforce). Universal gates (hardcodedConfig,
    // testFileProtection) are never in this set. See registry.ts.
    if (skippedGateKeys?.has(gate.key)) {
      // Match the kebab-case id convention that the fired gates emit
      // (e.g. 'duplicateBlocks' registry key → 'duplicate-blocks' id).
      // Downstream consumers look gates up by id, so skipped entries need
      // the same id shape as run entries for the same gate.
      const id = gate.key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
      gateResults.push({
        id,
        title: gate.title,
        status: 'skip',
        durationMs: 0,
        issues: [],
      });
      continue;
    }
    gateResults.push(await gate.run(ctx, gateConfig, config.maxFileSizeBytes));
  }

  // Downgrade gate failures when the entire gate covers requirements that are
  // in the skip tier for the current task type. This prevents API projects from
  // failing on accessibility checks, or CLI projects from failing on security headers.
  if (ctx.skippedRequirementIds && ctx.skippedRequirementIds.size > 0) {
    const GATE_TO_REQUIREMENT_IDS: Record<string, string[]> = {
      'accessibility': ['aria-attributes', 'aria-interactive', 'responsive-layout', 'skip-link', 'dark-mode', 'focus-visible', 'semantic-html', 'keyboard-navigation', 'responsive-breakpoint'],
    };
    for (const result of gateResults) {
      if (result.status !== 'fail') continue;
      const mappedIds = GATE_TO_REQUIREMENT_IDS[result.id];
      if (!mappedIds) continue;
      const allSkipped = mappedIds.every(id => ctx.skippedRequirementIds!.has(id));
      if (allSkipped) {
        result.status = 'skip';
        result.issues = [];
      }
    }
  }

  const hardPassed = true;
  const totalDurationMs = Date.now() - start;

  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });

    const jsonPath = path.join(outDir, 'quality-gates.json');
    fs.writeFileSync(jsonPath, JSON.stringify({
      projectRoot,
      passed: hardPassed,
      advisory: true,
      totalDurationMs,
      results: gateResults
    }, null, 2), 'utf8');

    const mdPath = path.join(outDir, 'quality-gates.md');
    const mdLines: string[] = [];
    mdLines.push('# Quality Gates Report');
    mdLines.push('');
    mdLines.push(`Root: ${projectRoot}`);
    mdLines.push('Status: ✅ PASSED (advisory findings only)');
    mdLines.push(`Duration: ${totalDurationMs}ms`);
    mdLines.push('');

    for (const gr of gateResults) {
      const icon = gr.status === 'pass' ? '✅' : gr.status === 'skip' ? '⏭️' : '❌';
      mdLines.push(`## ${icon} ${gr.title} (${gr.id})`);
      mdLines.push('');

      if (gr.issues.length === 0) {
        mdLines.push('No issues found.');
        mdLines.push('');
        continue;
      }

      for (const issue of gr.issues) {
        mdLines.push(format_issue(issue));
        if (issue.excerpt) {
          mdLines.push('');
          mdLines.push('```');
          mdLines.push(issue.excerpt);
          mdLines.push('```');
        }
        if (issue.hint) {
          mdLines.push('');
          mdLines.push(`hint: ${issue.hint}`);
        }
        mdLines.push('');
      }
    }

    fs.writeFileSync(mdPath, mdLines.join('\n'), 'utf8');
  }

  return { passed: hardPassed, advisory: true, results: gateResults, totalDurationMs };
}
