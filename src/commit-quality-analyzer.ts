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

  // Surface anti-patterns; suppress the "all good" announcement so passing
  // steps stay quiet and the live status block carries the success signal.
  if (result.hasAntiPatterns) {
    logger.warn(`  commit-quality warnings · step ${stepNumber} (${agentName}) · score ${result.score}/100`);
    result.warnings.forEach(warning => {
      logger.warn(`    - ${warning}`);
    });
    const suggestions = detector.getSuggestions(result);
    if (suggestions.length > 0) {
      logger.warn(`    suggestions:`);
      suggestions.forEach(suggestion => {
        logger.warn(`      - ${suggestion}`);
      });
    }
  }
}
