import { eligibility } from "./capacity.ts";
import { listOllama, ollamaBase, ollamaChat, ollamaVersion } from "./ollama.ts";
import { type ProbeResult, probeModel } from "./probe.ts";
import { cachedProbe, type ModelRecord, modelRecord, withProbe } from "./profile.ts";

export interface SurveyRow {
  readonly name: string;
  readonly eligible: boolean;
  /** Why it is or is not a candidate, with its memory need where it could be estimated. */
  readonly capacity: string;
  readonly probe: ProbeResult | null;
}

const gib = 1024 ** 3;

/**
 * Every installed Ollama model, its capacity at the configured context and, for every eligible
 * one, its readiness probe (cached by model and runtime identity, so a second survey reads the
 * profile). One model is loaded at a time and unloaded after its probe.
 */
export async function surveyModels(input: {
  readonly contextTokens: number;
  readonly home: string;
  readonly record?: ModelRecord;
  readonly log: (line: string) => void;
}): Promise<{ readonly runtime: string; readonly rows: readonly SurveyRow[] }> {
  const base = ollamaBase();
  const version = await ollamaVersion(base);
  if (version === null)
    throw new Error(`Ollama is not answering at ${base}: start it with \`ollama serve\``);
  const record = input.record ?? modelRecord(input.home);
  let profile = await record.read();
  const rows: SurveyRow[] = [];
  for (const one of eligibility(await listOllama(base), input.contextTokens)) {
    const model = one.model;
    const weights =
      model.sizeBytes === null ? "" : ` (${(model.sizeBytes / gib).toFixed(1)} GiB on disk)`;
    if (!one.eligible) {
      rows.push({
        name: model.name,
        eligible: false,
        capacity: `${one.reason}${weights}`,
        probe: null,
      });
      continue;
    }
    const identity = {
      runtime: "ollama" as const,
      runtimeVersion: version,
      endpoint: base,
      model: model.name,
      digest: model.digest,
      quantization: model.quantization,
      contextTokens: input.contextTokens,
    };
    let result = cachedProbe(profile, identity);
    if (result === null) {
      input.log(`probing ${model.name}`);
      result = await probeModel(
        ollamaChat({ base, model: model.name, contextTokens: input.contextTokens, keepAlive: "0" }),
        input.contextTokens,
      );
      profile = withProbe(profile, identity, result);
      await record.write(profile);
    }
    rows.push({ name: model.name, eligible: true, capacity: one.reason, probe: result });
  }
  return { runtime: `Ollama ${version} at ${base}`, rows };
}
