import type { ObligationV1 } from '../contract/types';
import type { ObligationStatus, PopulationState } from '../persona/predicates';

/**
 * Mutable companion to the read-only `PopulationState`. The population
 * manager owns one instance; the predicate evaluator only ever sees a
 * snapshot via the `view()` method.
 */
export class PopulationStateBuilder {
  private readonly oblg: ObligationV1[];
  private readonly status: ObligationStatus[];

  constructor(obligations: readonly ObligationV1[]) {
    this.oblg = [...obligations];
    this.status = obligations.map(() => 'pending');
  }

  /** Read-only view passed to predicates. */
  view(): PopulationState {
    return { obligations: this.oblg, status: this.status };
  }

  /** Total obligation count. */
  size(): number {
    return this.oblg.length;
  }

  /** Status at the given index. Throws on out-of-range. */
  statusAt(index: number): ObligationStatus {
    const s = this.status[index];
    if (s === undefined) {
      throw new Error(`obligation index ${index} out of range (size=${this.oblg.length})`);
    }
    return s;
  }

  /** Mutate obligation status. */
  setStatus(index: number, status: ObligationStatus): void {
    if (this.status[index] === undefined) {
      throw new Error(`obligation index ${index} out of range (size=${this.oblg.length})`);
    }
    this.status[index] = status;
  }

  /** Number of obligations in the given status. */
  countInStatus(status: ObligationStatus): number {
    let count = 0;
    for (const s of this.status) if (s === status) count += 1;
    return count;
  }
}
