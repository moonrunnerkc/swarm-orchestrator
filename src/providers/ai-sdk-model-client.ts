import { generateText, type LanguageModel, type ToolSet, tool } from "ai";
import type { ModelClient, ModelRequest, ModelResponse, ToolSchema } from "../core/model-client.ts";
import { toModelMessages } from "./message-conversion.ts";

/**
 * Wraps an AI SDK language model as a ModelClient. One model call per invocation:
 * the agent loop owns iteration, so the SDK is never asked to run its own.
 */
export function createAiSdkModelClient(modelId: string, model: LanguageModel): ModelClient {
  return {
    modelId,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const result = await generateText({
        model,
        system: request.system,
        messages: toModelMessages(request.messages),
        tools: toToolSet(request.tools),
        maxOutputTokens: request.maxOutputTokens,
        abortSignal: request.abortSignal,
      });

      return {
        text: result.text,
        toolCalls: result.toolCalls.map((call) => ({
          callId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
        })),
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        finishReason: result.finishReason,
      };
    },
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
