/** Injected randomness. Nothing under src/core reads Math.random (invariant 8). */
export interface RandomSource {
  /** Uniformly distributed in [0, 1). */
  next(): number;
}
