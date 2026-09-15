import { servedModelsTimeoutMs } from "./cli-select.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { fetchServedModels } from "./providers/served-models.ts";
import {
  type LocalModelPreflight,
  preflightLocalModels,
  preflightRecord,
} from "./select/model-preflight.ts";

/** The whole answer rather than the runnable subset, for the caller that has to choose. */
export async function preflightAll(
  evidence: EvidenceRecorder,
  backendUrl: string,
  models: readonly string[],
): Promise<LocalModelPreflight> {
  const checked = preflightLocalModels({
    requested: models,
    backendUrl,
    list: await fetchServedModels({
      baseUrl: backendUrl,
      fetch: (url, init) => fetch(url, init),
      signal: AbortSignal.timeout(servedModelsTimeoutMs),
    }),
  });

  await evidence.record(preflightRecord(checked));
  return checked;
}
