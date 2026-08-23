import { type LanguageModel, streamText, type ToolSet, tool } from "ai";
import type {
  ModelClient,
  ModelPerformance,
  ModelRequest,
  ModelResponse,
  ToolSchema,
} from "../core/model-client.ts";
import { toModelMessages } from "./message-conversion.ts";

/**
 * Wraps an AI SDK language model as a ModelClient. One model call per invocation: the agent
 * loop owns iteration, so the SDK is never asked to run its own.
 *
 * Streamed rather than generated in one shot, for one reason: time to first token is a
 * calibration dimension, and a complete-response call cannot observe it. The stream is drained
 * here, so the loop still sees a whole response and nothing downstream changes.
 */
export function createAiSdkModelClient(modelId: string, model: LanguageModel): ModelClient {
  return {
    modelId,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const result = streamText({
        model,
        system: request.system,
        messages: toModelMessages(request.messages),
        tools: toToolSet(request.tools),
        maxOutputTokens: request.maxOutputTokens,
        // Spread rather than passed as undefined: the SDK sends a key it was given, and a
        // temperature of undefined on the wire is not the same as no temperature at all.
        ...(request.sampling === undefined
          ? {}
          : {
              temperature: request.sampling.temperature,
              topP: request.sampling.topP,
              ...(request.sampling.seed === null ? {} : { seed: request.sampling.seed }),
            }),
        abortSignal: request.abortSignal,
        // The SDK's default handler prints the whole error object, stack and response headers
        // included, straight over the running UI. Nothing is swallowed by replacing it: the
        // same error is raised out of the stream below and the loop renders it as one line.
        onError: () => {},
      });

      for await (const part of result.fullStream) {
        // A stream error is the call failing, so it is raised rather than left to surface as
        // an empty response the loop would read as a completion claim.
        if (part.type === "error") {
          throw part.error;
        }
      }

      const usage = await result.usage;
      return {
        text: await result.text,
        toolCalls: (await result.toolCalls).map((call) => ({
          callId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
        })),
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        finishReason: await result.finishReason,
        performance: performanceOf(await result.steps),
      };
    },
  };
}

/**
 * Timed inside the stream pipeline by the SDK, which is why this is read off the step rather
 * than measured around the call: a consumer-side clock sees the buffered pipeline, not the
 * arrival of the first token.
 */
function performanceOf(steps: Awaited<ReturnType<typeof streamText>["steps"]>): ModelPerformance {
  const step = steps[steps.length - 1]?.performance;
  return {
    firstTokenMs: step?.timeToFirstOutputMs ?? null,
    outputTokensPerSecond: step?.outputTokensPerSecond ?? null,
    responseTimeMs: step?.responseTimeMs ?? 0,
  };
}

/**
 * Declares tools without an `execute` function on purpose. The SDK then returns the
 * tool call instead of running it, leaving the chokepoint as the only execution path.
 */
function toToolSet(schemas: readonly ToolSchema[]): ToolSet {
  const toolSet: ToolSet = {};
  for (const schema of schemas) {
    toolSet[schema.name] = tool({
      description: schema.description,
      inputSchema: schema.inputSchema,
    });
  }
  return toolSet;
}
