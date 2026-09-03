/** Injected time source. Nothing under src/core reads the ambient clock (invariant 8). */
export interface Clock {
  /** Milliseconds since an arbitrary fixed origin. Only differences are meaningful. */
  now(): number;
  /**
   * Resolves after the interval, or as soon as `cancel` aborts, which is how a deadline armed
   * beside a call is let go of when the call returns first: a timer nobody cancels would
   * hold the process open for the whole interval after the run is over.
   */
  sleep(milliseconds: number, cancel?: AbortSignal): Promise<void>;
}
