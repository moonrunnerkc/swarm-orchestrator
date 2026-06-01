// Token-cost accounting and the spend ceiling for the real-PR harness.
// Prices are list estimates (USD per million tokens) and are flagged as
// such in the report; the point is a defensible ceiling, not invoicing.

import { SwarmError } from '../../../src/errors';

interface Price {
  inputPerMtok: number;
  outputPerMtok: number;
}

// Matched by substring against the resolved model id. Local models are
// free. Unknown Anthropic models fall back to the Opus rate so an
// estimate never under-counts.
const PRICES: Array<{ match: string; price: Price }> = [
  { match: 'opus', price: { inputPerMtok: 15, outputPerMtok: 75 } },
  { match: 'sonnet', price: { inputPerMtok: 3, outputPerMtok: 15 } },
  { match: 'haiku', price: { inputPerMtok: 1, outputPerMtok: 5 } },
];

const FALLBACK_PRICE: Price = { inputPerMtok: 15, outputPerMtok: 75 };

function priceFor(modelId: string): Price {
  const id = modelId.toLowerCase();
  if (id.startsWith('local:') || id === 'local') {
    return { inputPerMtok: 0, outputPerMtok: 0 };
  }
  for (const { match, price } of PRICES) {
    if (id.includes(match)) return price;
  }
  return FALLBACK_PRICE;
}

export interface CostSummary {
  ceilingUsd: number;
  spentUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  perModel: Array<{ model: string; calls: number; inputTokens: number; outputTokens: number; usd: number }>;
}

export class CostLedger {
  private readonly ceiling: number;
  private spent = 0;
  private calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private readonly byModel = new Map<
    string,
    { calls: number; inputTokens: number; outputTokens: number; usd: number }
  >();

  constructor(ceilingUsd: number) {
    this.ceiling = ceilingUsd;
  }

  /** Refuse to start another call when the spend so far is already at or
   *  over the ceiling. Called before each paid request so a runaway loop
   *  stops at the budget the operator set. */
  guardBeforeCall(): void {
    if (this.spent >= this.ceiling) {
      throw new SwarmError(
        `real-PR harness hit the cost ceiling: spent $${this.spent.toFixed(2)} of ` +
          `$${this.ceiling.toFixed(2)}. Raise it with --max-cost-usd to continue.`,
        'REAL_PRS_COST_CEILING',
        {
          remediation:
            'Re-run with a higher --max-cost-usd, or reduce the corpus size with --max-prs.',
        },
      );
    }
  }

  record(modelId: string, inputTokens: number, outputTokens: number): void {
    const price = priceFor(modelId);
    const usd =
      (inputTokens / 1_000_000) * price.inputPerMtok +
      (outputTokens / 1_000_000) * price.outputPerMtok;
    this.spent += usd;
    this.calls += 1;
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    const prior = this.byModel.get(modelId) ?? {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      usd: 0,
    };
    prior.calls += 1;
    prior.inputTokens += inputTokens;
    prior.outputTokens += outputTokens;
    prior.usd += usd;
    this.byModel.set(modelId, prior);
  }

  spentUsd(): number {
    return this.spent;
  }

  remainingUsd(): number {
    return Math.max(0, this.ceiling - this.spent);
  }

  summary(): CostSummary {
    return {
      ceilingUsd: this.ceiling,
      spentUsd: this.spent,
      calls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      perModel: [...this.byModel.entries()].map(([model, v]) => ({ model, ...v })),
    };
  }
}
