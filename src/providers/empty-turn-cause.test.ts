import { describe, expect, it } from "vitest";
import { classifyEmptyTurn, describeEmptyTurnCause, readWireContent } from "./empty-turn-cause.ts";

const emptyTurn = { text: "", toolCalls: 0 };

function stream(...chunks: readonly unknown[]): string {
  return [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`), "data: [DONE]", ""].join(
    "\n",
  );
}

describe("which of the three an empty turn was", () => {
  it("names a backend that sent a completion carrying nothing", () => {
    const wire = readWireContent(stream({ choices: [{ delta: {}, finish_reason: "stop" }] }));

    expect(wire.parsed).toBe(true);
    expect(classifyEmptyTurn(wire, emptyTurn)).toBe("backend-emitted-nothing");
  });

  it("names reasoning with no answer beside it, which is the template disagreeing", () => {
    const wire = readWireContent(
      stream({ choices: [{ delta: { reasoning_content: "let me think about the file" } }] }),
    );

    expect(classifyEmptyTurn(wire, emptyTurn)).toBe("reasoning-only");
  });

  it("names content that reached the wire and not the turn as this client's loss", () => {
    const wire = readWireContent(stream({ choices: [{ delta: { content: "done" } }] }));

    expect(classifyEmptyTurn(wire, emptyTurn)).toBe("client-dropped-content");
  });

  it("counts a tool call fragment as content, since a turn carrying one is not empty", () => {
    const wire = readWireContent(
      stream({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "read" } }] } }] }),
    );

    expect(classifyEmptyTurn(wire, emptyTurn)).toBe("client-dropped-content");
  });

  it("attributes nothing when the body is not a completion it can read", () => {
    const wire = readWireContent("<html>502 Bad Gateway</html>");

    expect(wire.parsed).toBe(false);
    expect(classifyEmptyTurn(wire, emptyTurn)).toBe("unreadable-response");
  });

  it("says nothing is wrong when the turn carried something", () => {
    const wire = readWireContent(stream({ choices: [{ delta: { content: "done" } }] }));

    expect(classifyEmptyTurn(wire, { text: "done", toolCalls: 0 })).toBe("not-empty");
  });

  it("reads a whole-response body as well as a stream, since a non-streamed call answers in one", () => {
    const wire = readWireContent(
      JSON.stringify({ choices: [{ message: { content: "", reasoning: "thinking" } }] }),
    );

    expect(classifyEmptyTurn(wire, emptyTurn)).toBe("reasoning-only");
  });

  it("reads whitespace-only content as no content, which is what the turn check reads it as", () => {
    const wire = readWireContent(stream({ choices: [{ delta: { content: "   \n\t" } }] }));

    expect(classifyEmptyTurn(wire, emptyTurn)).toBe("backend-emitted-nothing");
  });

  it("gives every cause a sentence naming which layer to look at", () => {
    for (const cause of [
      "not-empty",
      "backend-emitted-nothing",
      "reasoning-only",
      "client-dropped-content",
      "unreadable-response",
    ] as const) {
      expect(describeEmptyTurnCause(cause).length).toBeGreaterThan(0);
    }
  });
});
