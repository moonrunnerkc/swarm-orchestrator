import * as fs from 'fs';
import * as path from 'path';
import { AnalyticsEntry, RunMetrics, MetricsComparison } from './metrics-types';
import { getLogger } from './logger';
const logger = getLogger('analytics-log');

const ANALYTICS_SCHEMA_VERSION = 1;

/**
 * Append-only analytics log for orchestrator runs
 * Persists to runs/analytics.json
 */
export default class AnalyticsLog {
  private logPath: string;

  constructor(runsDir: string = 'runs') {
    this.logPath = path.join(runsDir, 'analytics.json');
  }

  /**
   * Append a run to the analytics log
   */
  appendRun(metrics: RunMetrics): void {
    const entry: AnalyticsEntry = {
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      metrics
    };

    let entries: AnalyticsEntry[] = [];
    
    if (fs.existsSync(this.logPath)) {
      try {
        const content = fs.readFileSync(this.logPath, 'utf8');
        entries = JSON.parse(content);
        
        // Validate schema
        if (!Array.isArray(entries)) {
          logger.warn('Analytics log is not an array, resetting');
          entries = [];
        }
      } catch (error) {
        logger.warn('Failed to parse analytics log, resetting:', error instanceof Error ? error.message : error);
        entries = [];
      }
    }

    entries.push(entry);
    
    // Ensure directory exists
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write atomically via temp file
    const tmpPath = this.logPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.logPath);
  }

  /**
   * Get recent runs (default: last 10)
   */
  getRecentRuns(count: number = 10): AnalyticsEntry[] {
    if (!fs.existsSync(this.logPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(this.logPath, 'utf8');
      const entries: AnalyticsEntry[] = JSON.parse(content);
      
      if (!Array.isArray(entries)) {
        return [];
      }

      // Return most recent entries
      return entries.slice(-count).reverse();
    } catch (error) {
      logger.warn('Failed to read analytics log:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  /**
   * Get all runs
   */
  getAllRuns(): AnalyticsEntry[] {
    if (!fs.existsSync(this.logPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(this.logPath, 'utf8');
      const entries: AnalyticsEntry[] = JSON.parse(content);
      
      if (!Array.isArray(entries)) {
        return [];
      }

      return entries;
    } catch (error) {
      logger.warn('Failed to read analytics log:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  /**
   * Compare current run with historical average
   */
  compareWithHistory(currentMetrics: RunMetrics, historyCount: number = 5): MetricsComparison | null {
    const recent = this.getRecentRuns(historyCount + 1); // +1 to exclude current if already logged
    
    // Filter out current run if it's already in the log
    const historical = recent.filter(e => e.metrics.executionId !== currentMetrics.executionId);
    
    if (historical.length === 0) {
      return null; // No history to compare
    }

    // Calculate averages
    const avgTime = historical.reduce((sum, e) => sum + e.metrics.totalTimeMs, 0) / historical.length;
    const avgCommits = historical.reduce((sum, e) => sum + e.metrics.commitCount, 0) / historical.length;
    const avgPassRate = historical.reduce((sum, e) => {
      const total = e.metrics.verificationsPassed + e.metrics.verificationsFailed;
      return sum + (total > 0 ? e.metrics.verificationsPassed / total : 0);
    }, 0) / historical.length;

    const currentTotal = currentMetrics.verificationsPassed + currentMetrics.verificationsFailed;
    const currentPassRate = currentTotal > 0 ? currentMetrics.verificationsPassed / currentTotal : 0;

    return {
      current: currentMetrics,
      averageHistorical: {
        totalTimeMs: avgTime,
        commitCount: avgCommits,
        verificationPassRate: avgPassRate
      },
      delta: {
        timePercent: avgTime > 0 ? ((currentMetrics.totalTimeMs - avgTime) / avgTime) * 100 : 0,
        commitCountDiff: currentMetrics.commitCount - avgCommits,
        passRateDiff: currentPassRate - avgPassRate
      }
    };
  }
}
