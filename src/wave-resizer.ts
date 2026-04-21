import { QueueStats } from './execution-queue';

export interface WaveResizeEvent {
  originalWave: number[];
  splitWaves: number[][];
  reason: 'rate_limit' | 'quota_exhaustion' | 'concurrent_failures';
  timestamp: string;
}

/**
 * dynamic wave resizer - splits waves when rate limits hit
 * or merges small waves for efficiency
 */
export class WaveResizer {
  private resizeHistory: WaveResizeEvent[] = [];

  /**
   * split wave into smaller chunks
   */
  splitWave(wave: number[], chunkSize: number, reason: WaveResizeEvent['reason']): number[][] {
    const splitWaves: number[][] = [];
    
    for (let i = 0; i < wave.length; i += chunkSize) {
      splitWaves.push(wave.slice(i, i + chunkSize));
    }

    const event: WaveResizeEvent = {
      originalWave: wave,
      splitWaves,
      reason,
      timestamp: new Date().toISOString()
    };
    
    this.resizeHistory.push(event);
    
    return splitWaves;
  }

  /**
   * merge small waves together if safe
   */
  mergeWaves(waves: number[][], dependencies: Map<number, number[]>): number[][] {
    const merged: number[][] = [];
    let currentMerge: number[] = [];

    for (const wave of waves) {
      // check if we can safely merge this wave with current
      const canMerge = wave.every(step => {
        const deps = dependencies.get(step) || [];
        return deps.every(dep => 
          currentMerge.includes(dep) === false || 
          merged.flat().includes(dep)
        );
      });

      if (canMerge && currentMerge.length + wave.length <= 5) {
        currentMerge.push(...wave);
      } else {
        if (currentMerge.length > 0) {
          merged.push(currentMerge);
        }
        currentMerge = [...wave];
      }
    }

    if (currentMerge.length > 0) {
      merged.push(currentMerge);
    }

    return merged;
  }

  /**
   * calculate optimal chunk size based on recent failures
   */
  calculateOptimalChunkSize(
    waveSize: number,
    recentFailures: number,
    queueStats: QueueStats
  ): number {
    // start conservative after failures
    if (recentFailures >= 3) {
      return 1; // one at a time
    } else if (recentFailures >= 1) {
      return Math.max(1, Math.floor(waveSize / 3));
    }

    // normal operation - respect max concurrency
    return Math.min(waveSize, queueStats.maxConcurrency);
  }

  /**
   * get resize history
   */
  getResizeHistory(): WaveResizeEvent[] {
    return [...this.resizeHistory];
  }
}

/**
 * adaptive concurrency manager - adjusts limits based on observed behavior
 * Starts at maxConcurrency (aggressive) and only backs off on failures.
 */
export class AdaptiveConcurrencyManager {
  private currentLimit: number;
  private minLimit: number = 1;
  private maxLimit: number;
  private consecutiveSuccesses: number = 0;
  private consecutiveFailures: number = 0;

  constructor(initialLimit: number = 3, maxLimit: number = 10) {
    // Start aggressive: use the configured limit immediately
    this.currentLimit = initialLimit;
    this.maxLimit = maxLimit;
  }

  /**
   * record successful execution
   */
  recordSuccess(): void {
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;

    // Recover toward maxLimit after backoff (2 successes to step up)
    if (this.consecutiveSuccesses >= 2 && this.currentLimit < this.maxLimit) {
      this.currentLimit = Math.min(this.currentLimit + 1, this.maxLimit);
      this.consecutiveSuccesses = 0;
    }
  }

  /**
   * record failure (rate limit or error)
   */
  recordFailure(reason: 'rate_limit' | 'error'): void {
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;

    // aggressive backoff on rate limits
    if (reason === 'rate_limit') {
      this.currentLimit = Math.max(
        this.minLimit,
        Math.floor(this.currentLimit / 2)
      );
    } else if (this.consecutiveFailures >= 3) {
      this.currentLimit = Math.max(
        this.minLimit,
        this.currentLimit - 1
      );
    }
  }

  /**
   * get current recommended limit
   */
  getCurrentLimit(): number {
    return this.currentLimit;
  }

  /**
   * force set limit
   */
  setLimit(limit: number): void {
    this.currentLimit = Math.max(this.minLimit, Math.min(limit, this.maxLimit));
  }
}
