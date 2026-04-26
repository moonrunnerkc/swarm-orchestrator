import * as path from 'path';
import { ExecutionPlan, PlanStep } from '../plan-generator';

export interface StepDependencyAnalysis {
  stepNumber: number;
  touchpoints: string[];
  sharedState: string[];
  conservative: boolean;
}

export interface PlanDependencyAnalysis {
  steps: Map<number, StepDependencyAnalysis>;
  conflicts: Map<number, Set<number>>;
  parallelizable: boolean;
}

const FILE_REF_RE = /\b(?:[\w.-]+\/)+(?:[\w.-]+|\*)\.(?:[cm]?[jt]sx?|py|java|go|rs|json|ya?ml|toml|md|css|html|sh|sql|dockerignore)\b/g;
const DIRECTORY_REF_RE = /\b(?:src|test|tests|lib|app|server|client|config|scripts|docs|benchmarks|agents|\.github|\.swarm)\/(?:[\w./-]+\/?)?/g;
const BARE_FILE_RE = /\b(?:Dockerfile|Makefile|package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig\.json|README\.md|\.env(?:\.\w+)?|\.dockerignore)\b/g;

/**
 * Conservatively infer file and state touchpoints from task text.
 *
 * Empty touchpoints make a step conservative, which means it conflicts with
 * other ready steps unless an explicit path is present in both tasks.
 */
export function analyzeStepTouchpoints(step: PlanStep): StepDependencyAnalysis {
  const text = [step.task, ...step.expectedOutputs].join('\n');
  const touchpoints = new Set<string>();

  collectMatches(text, FILE_REF_RE, touchpoints);
  collectMatches(text, DIRECTORY_REF_RE, touchpoints);
  collectMatches(text, BARE_FILE_RE, touchpoints);

  const sharedState = new Set<string>();
  if (/\b(database|db|migration|schema|sqlite|postgres|mysql|redis)\b/i.test(text)) {
    sharedState.add('state:database');
  }
  if (/\b(auth|session|cookie|token|login|logout)\b/i.test(text)) {
    sharedState.add('state:auth');
  }
  if (/\b(env|environment|secret|config var|configuration)\b/i.test(text)) {
    sharedState.add('state:environment');
  }
  if (/\b(test setup|test fixture|mock|seed data|global state)\b/i.test(text)) {
    sharedState.add('state:test-fixtures');
  }

  const normalized = Array.from(touchpoints)
    .map(normalizeTouchpoint)
    .filter(Boolean)
    .sort();

  return {
    stepNumber: step.stepNumber,
    touchpoints: unique(normalized),
    sharedState: Array.from(sharedState).sort(),
    conservative: normalized.length === 0,
  };
}

/**
 * Build a conflict graph for all plan steps.
 *
 * Steps conflict when touchpoints overlap, shared state overlaps, or either
 * step lacks enough static evidence to prove independence.
 */
export function analyzePlanDependencies(plan: ExecutionPlan): PlanDependencyAnalysis {
  const steps = new Map<number, StepDependencyAnalysis>();
  const conflicts = new Map<number, Set<number>>();

  for (const step of plan.steps) {
    const analysis = analyzeStepTouchpoints(step);
    steps.set(step.stepNumber, analysis);
    conflicts.set(step.stepNumber, new Set());
  }

  for (let i = 0; i < plan.steps.length; i += 1) {
    for (let j = i + 1; j < plan.steps.length; j += 1) {
      const a = steps.get(plan.steps[i].stepNumber)!;
      const b = steps.get(plan.steps[j].stepNumber)!;
      if (stepsConflict(a, b)) {
        conflicts.get(a.stepNumber)!.add(b.stepNumber);
        conflicts.get(b.stepNumber)!.add(a.stepNumber);
      }
    }
  }

  return {
    steps,
    conflicts,
    parallelizable: hasIndependentPair(plan.steps, conflicts),
  };
}

export function canRunTogether(
  analysis: PlanDependencyAnalysis,
  stepA: number,
  stepB: number,
): boolean {
  return !(analysis.conflicts.get(stepA)?.has(stepB));
}

function collectMatches(text: string, regex: RegExp, out: Set<string>): void {
  for (const match of text.matchAll(regex)) {
    if (isExcludedReference(text, match.index ?? 0)) continue;
    if (match[0]) out.add(match[0]);
  }
}

function isExcludedReference(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 80), index).toLowerCase();
  const lastBoundary = Math.max(before.lastIndexOf('\n'), before.lastIndexOf(';'));
  const phrase = before.slice(lastBoundary + 1);
  return /\b(excluding|exclude|excluded|ignore|ignoring|omit|omitting|skip|skipping)\b/.test(phrase);
}

function normalizeTouchpoint(value: string): string {
  const stripped = value.replace(/^[`'"]|[`'",.;:)]+$/g, '');
  const normalized = stripped.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized) return '';
  if (normalized.endsWith('/')) return normalized;
  if (!path.extname(normalized) && normalized.includes('/')) return `${normalized}/`;
  return normalized;
}

function stepsConflict(a: StepDependencyAnalysis, b: StepDependencyAnalysis): boolean {
  if (a.conservative || b.conservative) return true;
  if (a.sharedState.some(state => b.sharedState.includes(state))) return true;
  for (const left of a.touchpoints) {
    for (const right of b.touchpoints) {
      if (touchpointsOverlap(left, right)) return true;
    }
  }
  return false;
}

function touchpointsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  const aIsDir = a.endsWith('/');
  const bIsDir = b.endsWith('/');
  if (aIsDir && bIsDir) return a.startsWith(b) || b.startsWith(a);
  if (aIsDir) return b.startsWith(a);
  if (bIsDir) return a.startsWith(b);
  return false;
}

function hasIndependentPair(steps: PlanStep[], conflicts: Map<number, Set<number>>): boolean {
  for (let i = 0; i < steps.length; i += 1) {
    for (let j = i + 1; j < steps.length; j += 1) {
      const a = steps[i];
      const b = steps[j];
      if (!a.dependencies.includes(b.stepNumber) && !b.dependencies.includes(a.stepNumber)) {
        if (!(conflicts.get(a.stepNumber)?.has(b.stepNumber))) return true;
      }
    }
  }
  return false;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
