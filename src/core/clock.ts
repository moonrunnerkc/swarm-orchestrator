/** Injected time source. Nothing under src/core reads the ambient clock (invariant 8). */
export interface Clock {
  /** Milliseconds since an arbitrary fixed origin. Only differences are meaningful. */
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}
