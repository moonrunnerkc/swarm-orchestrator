import { ExecutionPlan } from '../plan-generator';
import {
  PlanDependencyAnalysis,
  analyzePlanDependencies,
  canRunTogether,
} from './dependency-analyzer';

export interface WorkStealingQueueOptions {
  maxWorkers?: number | undefined;
}

export interface WorkStealingQueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  maxWorkers: number;
  parallelEnabled: boolean;
}

/**
 * Dependency-aware queue for orchestrator steps.
 *
 * It is deliberately conservative: the static analyzer must prove that two
 * ready steps do not conflict before they can be dispatched together.
 */
export class WorkStealingQueue {
  private plan: ExecutionPlan;
  private analysis: PlanDependencyAnalysis;
  private pending = new Set<number>();
  private running = new Set<number>();
  private completed = new Set<number>();
  private failed = new Set<number>();
  private maxWorkers: number;

  constructor(plan: ExecutionPlan, options: WorkStealingQueueOptions = {}) {
    this.plan = plan;
    this.analysis = analyzePlanDependencies(plan);
    this.maxWorkers = Math.max(1, options.maxWorkers ?? 1);
    for (const step of plan.steps) this.pending.add(step.stepNumber);
  }

  syncPlan(plan: ExecutionPlan): void {
    this.plan = plan;
    this.analysis = analyzePlanDependencies(plan);
    const activeNumbers = new Set(plan.steps.map(step => step.stepNumber));

    for (const step of plan.steps) {
      if (!this.completed.has(step.stepNumber) && !this.failed.has(step.stepNumber) && !this.running.has(step.stepNumber)) {
        this.pending.add(step.stepNumber);
      }
    }

    for (const stepNumber of Array.from(this.pending)) {
      if (!activeNumbers.has(stepNumber)) this.pending.delete(stepNumber);
    }
  }

  nextDispatches(): number[] {
    const capacity = this.maxWorkers - this.running.size;
    if (capacity <= 0) return [];

    const ready = this.readySteps();
    const selected: number[] = [];
    for (const stepNumber of ready) {
      if (selected.length >= capacity) break;
      if (!this.canRunWithCurrentBatch(stepNumber, selected)) continue;
      selected.push(stepNumber);
    }
    return selected;
  }

  markRunning(stepNumber: number): void {
    this.pending.delete(stepNumber);
    this.running.add(stepNumber);
  }

  markCompleted(stepNumber: number): void {
    this.running.delete(stepNumber);
    this.completed.add(stepNumber);
  }

  markFailed(stepNumber: number): void {
    this.running.delete(stepNumber);
    this.failed.add(stepNumber);
  }

  setMaxWorkers(maxWorkers: number): void {
    this.maxWorkers = Math.max(1, maxWorkers);
  }

  hasPendingWork(): boolean {
    return this.pending.size > 0 || this.running.size > 0;
  }

  isBlocked(): boolean {
    return this.pending.size > 0 && this.running.size === 0 && this.readySteps().length === 0;
  }

  blockedSteps(): number[] {
    return Array.from(this.pending).sort((a, b) => a - b);
  }

  stats(): WorkStealingQueueStats {
    return {
      pending: this.pending.size,
      running: this.running.size,
      completed: this.completed.size,
      failed: this.failed.size,
      maxWorkers: this.maxWorkers,
      parallelEnabled: this.parallelEnabled(),
    };
  }

  getAnalysis(): PlanDependencyAnalysis {
    return this.analysis;
  }

  private readySteps(): number[] {
    const ready: number[] = [];
    for (const stepNumber of this.pending) {
      const step = this.plan.steps.find(candidate => candidate.stepNumber === stepNumber);
      if (!step) continue;
      if (step.dependencies.some(dep => this.failed.has(dep))) continue;
      if (step.dependencies.every(dep => this.completed.has(dep))) ready.push(stepNumber);
    }
    return ready.sort((a, b) => a - b);
  }

  private canRunWithCurrentBatch(stepNumber: number, selected: number[]): boolean {
    if (!this.parallelEnabled()) {
      return this.running.size === 0 && selected.length === 0;
    }
    for (const running of this.running) {
      if (!canRunTogether(this.analysis, stepNumber, running)) return false;
    }
    for (const candidate of selected) {
      if (!canRunTogether(this.analysis, stepNumber, candidate)) return false;
    }
    return true;
  }

  private parallelEnabled(): boolean {
    return this.maxWorkers > 1 && this.analysis.parallelizable;
  }
}
