import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { GateResult } from '../quality-gates/types';

export interface CompositeWeights {
  cheatDetector: number;
  propertyGate: number;
  attestation: number;
}

export interface CompositeScoreConfig {
  threshold: number;
  weights: CompositeWeights;
  advisoryGatePenalty: number;
  gateWeights: Record<string, number>;
}

export interface CompositeScoreInput {
  cheatDetectorScore: number;
  propertyGateScore: number;
  attestationScore: number;
  advisoryGateResults?: GateResult[];
  config?: Partial<CompositeScoreConfig>;
}

export interface CompositeScoreResult {
  score: number;
  threshold: number;
  humanReviewRequired: boolean;
  advisoryPenalty: number;
  weightedLayerScore: number;
}

export const DEFAULT_COMPOSITE_CONFIG: CompositeScoreConfig = {
  threshold: 0.7,
  weights: {
    cheatDetector: 0.4,
    propertyGate: 0.4,
    attestation: 0.2,
  },
  advisoryGatePenalty: 0.02,
  gateWeights: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(1, score));
}

function mergeConfig(config?: Partial<CompositeScoreConfig>): CompositeScoreConfig {
  return {
    ...DEFAULT_COMPOSITE_CONFIG,
    ...config,
    weights: {
      ...DEFAULT_COMPOSITE_CONFIG.weights,
      ...config?.weights,
    },
    gateWeights: {
      ...DEFAULT_COMPOSITE_CONFIG.gateWeights,
      ...config?.gateWeights,
    },
  };
}

/**
 * Load composite scoring configuration from `.swarm/gates.yaml`.
 *
 * @param projectRoot - Target repository root.
 * @returns Composite score configuration.
 */
export function loadCompositeScoreConfig(projectRoot: string): CompositeScoreConfig {
  const configPath = path.join(projectRoot, '.swarm', 'gates.yaml');
  if (!fs.existsSync(configPath)) return mergeConfig();

  const parsed = yaml.load(fs.readFileSync(configPath, 'utf8'));
  if (!isRecord(parsed) || !isRecord(parsed.verification)) return mergeConfig();
  const composite = parsed.verification.composite;
  if (!isRecord(composite)) return mergeConfig();
  const weights = isRecord(composite.weights) ? composite.weights : {};
  const gateWeights = isRecord(composite.gateWeights) ? composite.gateWeights : {};

  const cleanedGateWeights: Record<string, number> = {};
  for (const [key, value] of Object.entries(gateWeights)) {
    if (typeof value === 'number' && Number.isFinite(value)) cleanedGateWeights[key] = value;
  }

  const override: Partial<CompositeScoreConfig> = {
    weights: {
      cheatDetector: readNumber(weights, 'cheatDetector') ?? DEFAULT_COMPOSITE_CONFIG.weights.cheatDetector,
      propertyGate: readNumber(weights, 'propertyGate') ?? DEFAULT_COMPOSITE_CONFIG.weights.propertyGate,
      attestation: readNumber(weights, 'attestation') ?? DEFAULT_COMPOSITE_CONFIG.weights.attestation,
    },
    gateWeights: cleanedGateWeights,
  };
  const threshold = readNumber(composite, 'threshold');
  const advisoryGatePenalty = readNumber(composite, 'advisoryGatePenalty');
  if (threshold !== undefined) override.threshold = threshold;
  if (advisoryGatePenalty !== undefined) override.advisoryGatePenalty = advisoryGatePenalty;
  return mergeConfig(override);
}

function layerScore(input: CompositeScoreInput, config: CompositeScoreConfig): number {
  const weightSum = config.weights.cheatDetector + config.weights.propertyGate + config.weights.attestation;
  if (weightSum <= 0) return 0;
  const weighted =
    clampScore(input.cheatDetectorScore) * config.weights.cheatDetector +
    clampScore(input.propertyGateScore) * config.weights.propertyGate +
    clampScore(input.attestationScore) * config.weights.attestation;
  return weighted / weightSum;
}

function advisoryPenalty(gates: GateResult[] | undefined, config: CompositeScoreConfig): number {
  if (!gates || gates.length === 0) return 0;
  return gates
    .filter(gate => gate.status === 'fail')
    .reduce((sum, gate) => sum + (config.gateWeights[gate.id] ?? config.advisoryGatePenalty), 0);
}

/**
 * Compute the P1 advisory composite score.
 *
 * @param input - Layer 3-5 scores, advisory gates, and optional config.
 * @returns Composite score and human-review decision.
 */
export function computeCompositeScore(input: CompositeScoreInput): CompositeScoreResult {
  const config = mergeConfig(input.config);
  const weightedLayerScore = layerScore(input, config);
  const penalty = advisoryPenalty(input.advisoryGateResults, config);
  const score = Number(clampScore(weightedLayerScore - penalty).toFixed(3));

  return {
    score,
    threshold: config.threshold,
    humanReviewRequired: score < config.threshold,
    advisoryPenalty: Number(penalty.toFixed(3)),
    weightedLayerScore: Number(weightedLayerScore.toFixed(3)),
  };
}
