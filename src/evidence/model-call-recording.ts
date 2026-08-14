import {
  describeUnknownError,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
} from "../core/model-client.ts";
import { asJsonValue, digestOfJson, type JsonValue } from "./canonical-json.ts";
import { scrubJson } from "./scrub.ts";
import type { EvidenceRecorder } from "./session.ts";

/**
 * Records every model call as evidence: model id, the parameters it was called with, the
 * full prompt and response, and a digest of each. The digests are what an optional rerun
 * compares against later; divergence is the reportable outcome, never a claim that the
 * model reproduced itself.
 */
export function createRecordingModelClient(
  model: ModelClient,
  recorder: EvidenceRecorder,
): ModelClient {
  let step = 0;

  return {
    modelId: model.modelId,

    async generate(request: ModelRequest): Promise<ModelResponse> {
      step += 1;
      // Scrubbed before hashing so the digest addresses exactly what lands in the blob.
      const prompt = scrubJson(describeRequest(request)).value;
      const promptDigest = digestOfJson(prompt);

      let response: ModelResponse;
      try {
        response = await model.generate(request);
      } catch (cause) {
        const failure = scrubJson({ failed: true, message: describeUnknownError(cause) }).value;
        await recorder.record({
          type: "model-call",
          actor: model.modelId,
          provenance: ["model"],
          payload: { step, prompt, response: failure, inputTokens: 0, outputTokens: 0 },
          promptDigest,
          responseDigest: digestOfJson(failure),
        });
        throw cause;
      }

      const recordedResponse = scrubJson(asJsonValue(response)).value;
      await recorder.record({
        type: "model-call",
        actor: model.modelId,
        provenance: ["model"],
        payload: {
          step,
          prompt,
          response: recordedResponse,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          finishReason: response.finishReason,
          toolCallCount: response.toolCalls.length,
          // Flat and named, so a calibration score is a predicate over this record rather
          // than a number someone reports about it.
          performance: {
            firstTokenMs: response.performance.firstTokenMs,
            outputTokensPerSecond: response.performance.outputTokensPerSecond,
            responseTimeMs: response.performance.responseTimeMs,
          },
        },
        promptDigest,
        responseDigest: digestOfJson(recordedResponse),
      });

      return response;
    },
  };
}

function describeRequest(request: ModelRequest): JsonValue {
  return {
    system: request.system,
    messages: asJsonValue(request.messages),
    tools: request.tools.map((tool) => tool.name),
    maxOutputTokens: request.maxOutputTokens,
  };
}
