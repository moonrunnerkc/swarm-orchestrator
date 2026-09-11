import { z } from "zod";
import { createRecordingModelClient } from "../../src/evidence/model-call-recording.ts";
import { createProviderRegistry } from "../../src/providers/registry.ts";
import { record } from "./evidence.mjs";

export const models = {
  author: "gemma4:31b",
  checker: "mistral-small3.2:24b",
  solver: "qwen3.6:35b-a3b",
};
export const endpoint = "http://127.0.0.1:11434/v1";
const registry = createProviderRegistry({ localBaseUrl: endpoint, localThinking: false });

export function modelClient(model, evidence) {
  return createRecordingModelClient(
    registry.create({ provider: "local", modelId: model }),
    evidence,
    { transcript: "components" },
  );
}

export function parseModelJson(text, schema) {
  const fenced = text.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  return schema.parse(JSON.parse(fenced?.[1] ?? text));
}

export async function ask(evidence, model, prompt, schema, maxOutputTokens = 6000) {
  const started = Date.now();
  await record(evidence, "author-request", { model, prompt, maxOutputTokens, wallMs: 180000 });
  try {
    const response = await modelClient(model, evidence).generate({
      system:
        "Return only the requested JSON. You are authoring synthetic evaluation material, not judging a candidate implementation. Do not use markdown fences.",
      messages: [{ role: "user", text: prompt }],
      tools: [],
      maxOutputTokens,
      sampling: { temperature: 0, topP: 1, seed: 17 },
      abortSignal: AbortSignal.timeout(180000),
    });
    const parsed = parseModelJson(response.text, schema);
    await record(evidence, "author-accepted-shape", { model, elapsedMs: Date.now() - started });
    return parsed;
  } catch (cause) {
    await record(evidence, "author-failed", {
      model,
      elapsedMs: Date.now() - started,
      error: String(cause),
    });
    throw cause;
  }
}

export const sourceResponseSchema = z.object({ source: z.string().min(1).max(30000) });
