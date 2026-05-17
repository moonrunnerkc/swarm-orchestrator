import type { Session } from '../session/types';
import type { ProviderAttribution } from '../ledger/types';

export function providerAttribution(session: Session): ProviderAttribution {
  if (typeof session.providerInfo !== 'function') return {};
  const info = session.providerInfo();
  return {
    provider: info.provider,
    modelId: info.model,
    backend: info.backend,
    grammar: info.grammar,
    seed: info.seed,
    usageEstimated: info.usageEstimated,
  };
}
