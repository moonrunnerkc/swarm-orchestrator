import { strict as assert } from 'assert';
import { StepCostRecord, CostAttribution } from '../src/metrics-types';

describe('CostAttribution types', () => {
  it('constructs a valid StepCostRecord', () => {
    const record: StepCostRecord = {
      stepNumber: 1,
      agentName: 'worker',
      estimatedPremiumRequests: 5,
      actualPremiumRequests: 7,
      retryCount: 1,
      promptTokens: 3200,
      fleetMode: false,
      durationMs: 45000,
    };

    assert.strictEqual(record.stepNumber, 1);
    assert.strictEqual(record.agentName, 'worker');
    assert.strictEqual(record.estimatedPremiumRequests, 5);
    assert.strictEqual(record.actualPremiumRequests, 7);
    assert.strictEqual(record.retryCount, 1);
    assert.strictEqual(record.fleetMode, false);
  });

  it('constructs a valid CostAttribution with per-step breakdown', () => {
    const stepRecords: StepCostRecord[] = [
      {
        stepNumber: 1,
        agentName: 'worker',
        estimatedPremiumRequests: 5,
        actualPremiumRequests: 7,
        retryCount: 1,
        promptTokens: 3200,
        fleetMode: false,
        durationMs: 45000,
      },
      {
        stepNumber: 2,
        agentName: 'FrontendWizard',
        estimatedPremiumRequests: 3,
        actualPremiumRequests: 3,
        retryCount: 0,
        promptTokens: 2100,
        fleetMode: true,
        durationMs: 32000,
      },
    ];

    const attribution: CostAttribution = {
      totalEstimatedPremiumRequests: 8,
      totalActualPremiumRequests: 10,
      estimateAccuracy: 0.8,
      modelUsed: 'claude-sonnet-4',
      modelMultiplier: 1,
      overageTriggered: false,
      perStep: stepRecords,
    };

    assert.strictEqual(attribution.totalEstimatedPremiumRequests, 8);
    assert.strictEqual(attribution.totalActualPremiumRequests, 10);
    assert.strictEqual(attribution.estimateAccuracy, 0.8);
    assert.strictEqual(attribution.perStep.length, 2);
    assert.strictEqual(attribution.overageTriggered, false);
  });

  it('calculates accuracy ratio from attribution data', () => {
    const attribution: CostAttribution = {
      totalEstimatedPremiumRequests: 45,
      totalActualPremiumRequests: 52,
      estimateAccuracy: 0,
      modelUsed: 'o3',
      modelMultiplier: 20,
      overageTriggered: true,
      perStep: [],
    };

    // Accuracy = 1 - |estimated - actual| / actual
    const computedAccuracy = 1 - Math.abs(
      attribution.totalEstimatedPremiumRequests - attribution.totalActualPremiumRequests,
    ) / attribution.totalActualPremiumRequests;

    assert.ok(computedAccuracy > 0.8, `Accuracy ${computedAccuracy} should be > 0.8`);
    assert.ok(computedAccuracy < 1.0, `Accuracy ${computedAccuracy} should be < 1.0`);
  });

  it('handles empty per-step breakdown', () => {
    const attribution: CostAttribution = {
      totalEstimatedPremiumRequests: 0,
      totalActualPremiumRequests: 0,
      estimateAccuracy: 1.0,
      modelUsed: 'gpt-4o',
      modelMultiplier: 1,
      overageTriggered: false,
      perStep: [],
    };

    assert.strictEqual(attribution.perStep.length, 0);
    assert.strictEqual(attribution.estimateAccuracy, 1.0);
  });

  it('serializes to JSON and back without data loss', () => {
    const original: CostAttribution = {
      totalEstimatedPremiumRequests: 12,
      totalActualPremiumRequests: 15,
      estimateAccuracy: 0.8,
      modelUsed: 'claude-sonnet-4',
      modelMultiplier: 1,
      overageTriggered: false,
      perStep: [{
        stepNumber: 1,
        agentName: 'TestAgent',
        estimatedPremiumRequests: 12,
        actualPremiumRequests: 15,
        retryCount: 2,
        promptTokens: 4000,
        fleetMode: false,
        durationMs: 60000,
      }],
    };

    const json = JSON.stringify(original);
    const restored: CostAttribution = JSON.parse(json);

    assert.strictEqual(restored.totalEstimatedPremiumRequests, original.totalEstimatedPremiumRequests);
    assert.strictEqual(restored.totalActualPremiumRequests, original.totalActualPremiumRequests);
    assert.strictEqual(restored.perStep[0].agentName, 'TestAgent');
    assert.strictEqual(restored.perStep[0].retryCount, 2);
  });
});
