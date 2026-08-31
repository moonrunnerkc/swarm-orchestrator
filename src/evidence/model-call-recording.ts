import {
  describeUnknownError,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
} from "../core/model-client.ts";
import { asJsonValue, digestOfJson, type JsonValue } from "./canonical-json.ts";
import { scrubJson } from "./scrub.ts";
import type { EvidenceRecorder } from "./session.ts";
import { callFailedTurn, classifyTurnContent } from "./turn-content.ts";

/**
 * Records every model call as evidence: model id, the parameters it was called with, the
 * full prompt and response, and a digest of each. The digests are what an optional rerun
 * compares against later; divergence is the reportable outcome, never a claim that the
 * model reproduced itself.
 *
 * This is the boundary a turn crosses to become part of a bundle, so it is where the harness
 * says whether the turn carried anything. The verdict travels with the record rather than
 * being recomputed downstream: a reviewer holding the bundle can see that a turn was empty
 * without reassembling the response, and no later reader has to decide it again.
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
          payload: {
            step,
            prompt,
            response: failure,
            inputTokens: 0,
            outputTokens: 0,
            content: { ...callFailedTurn },
          },
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
          // Harness-computed, over the assembled response the model cannot reach. An empty
          // turn recorded without this is a turn that later reads as a run of the model.
          content: { ...classifyTurnContent(response) },
          // What the backend would not take. Recorded beside the settings that were sent, so
          // a seed in the prompt record is never read as a seed the sampler used.
          unsupportedFeatures: [...response.unsupportedFeatures],
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
    // What the decoding was, in the record, so a report of a distribution names the settings
    // it was drawn under rather than leaving a reader to assume the backend's defaults.
    sampling:
      request.sampling === undefined
        ? null
        : {
            temperature: request.sampling.temperature,
            topP: request.sampling.topP,
            seed: request.sampling.seed,
          },
  };
}
