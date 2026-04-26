import * as assert from 'assert';
import MetricsCollector from '../src/metrics-collector.js';
import { RecoveryEvent } from '../src/metrics-types.js';

describe('MetricsCollector', () => {
  it('should initialize with execution ID and goal', () => {
    const collector = new MetricsCollector('exec-123', 'Build todo app');
    const snapshot = collector.getSnapshot();
    
    assert.strictEqual(snapshot.executionId, 'exec-123');
    assert.strictEqual(snapshot.goal, 'Build todo app');
    assert.ok(snapshot.startTime);
  });

  it('should track waves', () => {
    const collector = new MetricsCollector('exec-456', 'Test goal');
    
    collector.startWave(1);
    collector.startWave(2);
    collector.startWave(3);
    
    const snapshot = collector.getSnapshot();
    assert.strictEqual(snapshot.waveCount, 3);
  });

  it('should track steps and agents', () => {
    const collector = new MetricsCollector('exec-789', 'Test goal');
    
    collector.trackStep(1, 'worker');
    collector.trackStep(2, 'worker');
    collector.trackStep(3, 'reviewer');
    
    const snapshot = collector.getSnapshot();
    assert.strictEqual(snapshot.stepCount, 3);
    assert.ok(snapshot.agentsUsed);
    assert.strictEqual(snapshot.agentsUsed.length, 2);
    assert.ok(snapshot.agentsUsed.includes('worker'));
    assert.ok(snapshot.agentsUsed.includes('reviewer'));
  });

  it('should track commits', () => {
    const collector = new MetricsCollector('exec-101', 'Test goal');
    
    collector.trackCommit('worker');
    collector.trackCommit('worker');
    collector.trackCommit('worker');
    collector.trackCommit();
    
    const snapshot = collector.getSnapshot();
    assert.strictEqual(snapshot.commitCount, 4);
  });

  it('should track verifications', () => {
    const collector = new MetricsCollector('exec-202', 'Test goal');
    
    collector.trackVerification(true);
    collector.trackVerification(true);
    collector.trackVerification(false);
    collector.trackVerification(true);
    
    const snapshot = collector.getSnapshot();
    assert.strictEqual(snapshot.verificationsPassed, 3);
    assert.strictEqual(snapshot.verificationsFailed, 1);
  });

  it('should track recovery events', () => {
    const collector = new MetricsCollector('exec-303', 'Test goal');
    
    const recovery: RecoveryEvent = {
      stepNumber: 2,
      agentName: 'worker',
      failedAt: new Date().toISOString(),
      recoveredAt: new Date().toISOString(),
      recoveryMethod: 'retry'
    };
    
    collector.trackRecovery(recovery);
    
    const snapshot = collector.getSnapshot();
    assert.ok(snapshot.recoveryEvents);
    assert.strictEqual(snapshot.recoveryEvents.length, 1);
    assert.strictEqual(snapshot.recoveryEvents[0].stepNumber, 2);
    assert.strictEqual(snapshot.recoveryEvents[0].recoveryMethod, 'retry');
  });

  it('should finalize metrics with end time', () => {
    const collector = new MetricsCollector('exec-404', 'Test goal');
    
    collector.trackStep(1, 'worker');
    collector.trackCommit('worker');
    collector.trackVerification(true);
    
    const metrics = collector.finalize();
    
    assert.ok(metrics.endTime);
    assert.ok(metrics.totalTimeMs >= 0);
    assert.strictEqual(metrics.commitCount, 1);
    assert.strictEqual(metrics.verificationsPassed, 1);
  });

  it('should calculate total time correctly', () => {
    const collector = new MetricsCollector('exec-505', 'Test goal');
    
    // Wait a bit
    const start = Date.now();
    while (Date.now() - start < 50) {
      // busy wait
    }
    
    const metrics = collector.finalize();
    assert.ok(metrics.totalTimeMs >= 50);
    assert.ok(metrics.totalTimeMs < 1000); // should be under 1 second
  });

  it('should sort agents alphabetically', () => {
    const collector = new MetricsCollector('exec-606', 'Test goal');
    
    collector.trackStep(1, 'ZetaAgent');
    collector.trackStep(2, 'AlphaAgent');
    collector.trackStep(3, 'BetaAgent');
    
    const metrics = collector.finalize();
    assert.strictEqual(metrics.agentsUsed[0], 'AlphaAgent');
    assert.strictEqual(metrics.agentsUsed[1], 'BetaAgent');
    assert.strictEqual(metrics.agentsUsed[2], 'ZetaAgent');
  });

  it('should handle highest wave and step numbers', () => {
    const collector = new MetricsCollector('exec-707', 'Test goal');
    
    collector.startWave(2);
    collector.startWave(1);
    collector.startWave(5);
    
    collector.trackStep(3, 'Agent1');
    collector.trackStep(1, 'Agent2');
    collector.trackStep(7, 'Agent3');
    
    const metrics = collector.finalize();
    assert.strictEqual(metrics.waveCount, 5);
    assert.strictEqual(metrics.stepCount, 7);
  });
});
