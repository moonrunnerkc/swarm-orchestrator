import * as fs from 'fs';
import * as path from 'path';
import { ExecutionPlan } from '../plan-generator';
import { getLogger } from '../logger';

const logger = getLogger('orchestrator');

/**
 * Structural subset of `MetaReviewResult` that this module consumes. Mirrored
 * locally so we do not import from `meta-analyzer.ts`, which would pull in
 * `ParallelStepResult` from `swarm-orchestrator.ts` and extend the pre-existing
 * meta-analyzer ↔ swarm-orchestrator cycle through this file.
 */
interface WaveAnalysisResult {
  knowledgeUpdates: Array<{
    category: string;
    insight: string;
    confidence: string;
    evidence: string;
  }>;
}

/**
 * Narrow shape of the MetaAnalyzer collaborator this module calls. Same
 * rationale as above — duck-typed locally to avoid the import.
 */
interface WaveAnalyzerLike {
  analyzeWave(
    waveIndex: number,
    waveSteps: number[],
    results: unknown[],
    plan: ExecutionPlan,
    executionId: string
  ): WaveAnalysisResult;
}

/**
 * Narrow shape of the KnowledgeBaseManager collaborator this module calls.
 */
interface KnowledgeBaseLike {
  addOrUpdatePattern(pattern: {
    category: string;
    insight: string;
    confidence: string;
    evidence: string[];
    impact: string;
  }): void;
}

/**
 * Context subset needed by `runAsyncMetaAnalysis`. Mirrors the fields it
 * actually reads from `SwarmExecutionContext`, following the same pattern
 * as `prompt-builder.ts` so this module does not import from
 * `swarm-orchestrator` and therefore does not introduce a circular edge.
 */
export interface AsyncMetaAnalysisContext {
  executionId: string;
  results: unknown[];
  metaAnalyzer?: WaveAnalyzerLike;
  knowledgeBase?: KnowledgeBaseLike;
  waveAnalyses?: WaveAnalysisResult[];
}

/**
 * Run meta-analysis off the critical path. Fires asynchronously via setImmediate
 * from the scheduler so the next step can launch without waiting for KB updates.
 *
 * Writes `analysis-batch-<waveIndex>.json` to `runDir` and feeds detected
 * knowledge updates into the KnowledgeBase on the context. Swallows errors
 * with a warning so analytics failures never block execution.
 *
 * No-ops when `context.metaAnalyzer` or `context.knowledgeBase` is undefined.
 *
 * @param context - subset of the swarm execution context carrying metaAnalyzer, knowledgeBase, results, waveAnalyses
 * @param plan - the current execution plan
 * @param runDir - directory where the analysis snapshot is persisted
 * @param completedSteps - step numbers that have completed so far (defines the "wave" analyzed)
 */
export function runAsyncMetaAnalysis(
  context: AsyncMetaAnalysisContext,
  plan: ExecutionPlan,
  runDir: string,
  completedSteps: number[]
): void {
  if (!context.metaAnalyzer || !context.knowledgeBase) return;

  // Use the most recent completed step as the "wave" we are analyzing
  const waveIndex = completedSteps.length;

  try {
    const waveAnalysis = context.metaAnalyzer.analyzeWave(
      waveIndex,
      completedSteps,
      context.results,
      plan,
      context.executionId
    );

    context.waveAnalyses?.push(waveAnalysis);

    // Persist analysis snapshot
    const analysisPath = path.join(runDir, `analysis-batch-${waveIndex}.json`);
    fs.writeFileSync(analysisPath, JSON.stringify(waveAnalysis, null, 2), 'utf8');

    // Feed insights back into the knowledge base
    if (waveAnalysis.knowledgeUpdates.length > 0) {
      waveAnalysis.knowledgeUpdates.forEach(update => {
        context.knowledgeBase!.addOrUpdatePattern({
          category: update.category,
          insight: update.insight,
          confidence: update.confidence,
          evidence: [update.evidence],
          impact: update.confidence === 'high' ? 'high' : 'medium'
        });
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[analytics] Wave analysis failed (non-fatal): ${msg}`);
  }
}
