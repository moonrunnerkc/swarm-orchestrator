export const providerIds = ["anthropic", "openai", "google", "local", "fixture"] as const;

export type ProviderId = (typeof providerIds)[number];

export interface ModelSpec {
  readonly provider: ProviderId;
  readonly modelId: string;
}

export class InvalidModelSpecError extends Error {
  readonly spec: string;

  constructor(spec: string, problem: string) {
    super(
      `cannot use model spec "${spec}": ${problem}. ` +
        `Expected "<provider>:<model-id>" with provider one of ${providerIds.join(", ")}.`,
    );
    this.name = "InvalidModelSpecError";
    this.spec = spec;
  }
}

function isProviderId(candidate: string): candidate is ProviderId {
  return (providerIds as readonly string[]).includes(candidate);
}

/**
 * Splits on the first colon only: Ollama model ids carry their own colon
 * (`qwen3.6:35b-a3b`), so a greedy split would mangle them.
 */
export function parseModelSpec(spec: string): ModelSpec {
  const separator = spec.indexOf(":");
  if (separator === -1) {
    throw new InvalidModelSpecError(spec, "no provider prefix");
  }

  const provider = spec.slice(0, separator);
  const modelId = spec.slice(separator + 1);
  if (!isProviderId(provider)) {
    throw new InvalidModelSpecError(spec, `unknown provider "${provider}"`);
  }
  if (modelId.length === 0) {
    throw new InvalidModelSpecError(spec, "the model id is empty");
  }
  return { provider, modelId };
}
