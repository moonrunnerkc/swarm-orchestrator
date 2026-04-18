import { CommitPatternDetector, CommitMessage } from './commit-pattern-detector';
import { ShareIndex } from './share-parser';
import { getLogger } from './logger';

const logger = getLogger('commit-quality');

export async function analyzeCommitQuality(
  commits: ShareIndex['gitCommits'],
  stepNumber: number,
  agentName: string
): Promise<void> {
  if (commits.length === 0) return;

  const detector = new CommitPatternDetector();

  // Convert to CommitMessage format; parsed commits may carry extra
  // fields (timestamp, files) beyond the ShareIndex schema
  const commitMessages: CommitMessage[] = commits.map(c => {
    const extra = c as Record<string, unknown>;
    return {
      hash: c.sha || 'unknown',
      message: c.message || '',
      timestamp: extra.timestamp ? new Date(extra.timestamp as string) : new Date(),
      files: (extra.files as string[]) || []
    };
  });

  const result = detector.analyzeCommits(commitMessages);

  // Log analysis results if anti-patterns detected
  if (result.hasAntiPatterns) {
    logger.info(`  ⚠️  Commit quality warnings for Step ${stepNumber} (${agentName}):`);
    logger.info(`      Quality score: ${result.score}/100`);
    result.warnings.forEach(warning => {
      logger.info(`      - ${warning}`);
    });

    // Get suggestions
    const suggestions = detector.getSuggestions(result);
    if (suggestions.length > 0) {
      logger.info(`      Suggestions:`);
      suggestions.forEach(suggestion => {
        logger.info(`        • ${suggestion}`);
      });
    }

    // Just log warnings - don't store in context (data type mismatch)
    // Meta-analyzer will detect commit quality issues from transcripts
  } else if (result.score >= 90) {
    // Acknowledge good commit practices
    logger.info(`  ✨ Excellent commit quality: ${result.score}/100 (${commitMessages.length} commits)`);
  }
}
