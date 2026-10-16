import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A local OpenAI-compatible endpoint that answers from a script: the deterministic substrate
 * for driving the whole product through its ordinary command line, the way the fixture
 * provider is the substrate for driving the loop in process. It serves the two routes the
 * product reads (the model list and streamed chat completions) and nothing else, records every
 * request body it was sent, and answers each completion with the next scripted turn. A script
 * that runs out answers with a text turn that says so, which the loop reads as a completion
 * claim and ends on, so an exhausted script never hangs a run.
 */
export interface ScriptedToolCall {
  readonly name: string;
  readonly input: unknown;
}

export interface ScriptedTurn {
  readonly text?: string;
  readonly toolCalls?: readonly ScriptedToolCall[];
  /** How long the endpoint holds the request before it starts streaming the turn; a model that is slow to answer. */
  readonly delayMs?: number;
}

export interface ScriptedEndpoint {
  /** The base url the product is pointed at, ending in `/v1`. */
  readonly url: string;
  readonly modelId: string;
  /** Every chat completion request body, in order. */
  readonly requests: readonly unknown[];
  /** How many scripted turns were played. */
  played(): number;
  close(): Promise<void>;
}

export async function startScriptedEndpoint(script: {
  readonly modelId: string;
  readonly turns: readonly ScriptedTurn[];
}): Promise<ScriptedEndpoint> {
  const requests: unknown[] = [];
  let played = 0;
  const server: Server = createServer((request, response) => {
    const path = (request.url ?? "").split("?")[0];
    if (request.method === "GET" && path === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: script.modelId }] }));
      return;
    }
    if (request.method === "POST" && path === "/v1/chat/completions") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        try {
          requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          requests.push(null);
        }
        const turn = script.turns[played] ?? {
          text: "The scripted endpoint has no more turns; finishing.",
        };
        played += 1;
        const sequence = played;
        if (turn.delayMs === undefined) streamTurn(response, script.modelId, turn, sequence);
        else setTimeout(() => streamTurn(response, script.modelId, turn, sequence), turn.delayMs);
      });
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: `no route for ${request.method} ${path}` } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    modelId: script.modelId,
    requests,
    played: () => played,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function streamTurn(
  response: import("node:http").ServerResponse,
  modelId: string,
  turn: ScriptedTurn,
  sequence: number,
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const id = `chatcmpl-${sequence}`;
  const chunk = (choices: unknown[], usage?: unknown): string =>
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: 0,
      model: modelId,
      choices,
      ...(usage === undefined ? {} : { usage }),
    })}\n\n`;
  response.write(
    chunk([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]),
  );
  if (turn.text !== undefined && turn.text.length > 0) {
    response.write(chunk([{ index: 0, delta: { content: turn.text }, finish_reason: null }]));
  }
  const calls = turn.toolCalls ?? [];
  calls.forEach((call, index) => {
    response.write(
      chunk([
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index,
                id: `call_${sequence}_${index}`,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.input) },
              },
            ],
          },
          finish_reason: null,
        },
      ]),
    );
  });
  response.write(
    chunk([{ index: 0, delta: {}, finish_reason: calls.length > 0 ? "tool_calls" : "stop" }]),
  );
  const completion = (turn.text?.length ?? 0) + calls.length * 20;
  response.write(
    chunk([], {
      prompt_tokens: 100,
      completion_tokens: completion,
      total_tokens: 100 + completion,
    }),
  );
  response.write("data: [DONE]\n\n");
  response.end();
}
