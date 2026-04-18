import { ExecutionPlan } from './plan-generator';

/**
 * Build a dependency graph from an execution plan.
 * Returns a map of step number → array of dependency step numbers.
 */
export function buildDependencyGraph(plan: ExecutionPlan): Map<number, number[]> {
  const graph = new Map<number, number[]>();

  plan.steps.forEach(step => {
    graph.set(step.stepNumber, step.dependencies);
  });

  return graph;
}

/**
 * Identify waves of parallel execution (topological sort by levels).
 * Each wave contains steps whose dependencies have all been completed
 * in prior waves.
 */
export function identifyExecutionWaves(graph: Map<number, number[]>): number[][] {
  const waves: number[][] = [];
  const completed = new Set<number>();
  const allSteps = Array.from(graph.keys());

  while (completed.size < allSteps.length) {
    const currentWave: number[] = [];

    // find steps whose dependencies are all completed
    for (const step of allSteps) {
      if (completed.has(step)) continue;

      const deps = graph.get(step) || [];
      const allDepsCompleted = deps.every(dep => completed.has(dep));

      if (allDepsCompleted) {
        currentWave.push(step);
      }
    }

    if (currentWave.length === 0) {
      throw new Error('Circular dependency detected or graph issue');
    }

    waves.push(currentWave);
    currentWave.forEach(step => completed.add(step));
  }

  return waves;
}
