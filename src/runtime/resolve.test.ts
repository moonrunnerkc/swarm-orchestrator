import { describe, expect, it } from "vitest";
import { NoFittingModelError, NoModelError, resolveAtContexts } from "./resolve.ts";

describe("choosing the context with the model", () => {
  it("takes the largest context at which a model fits, trying each in turn", async () => {
    const tried: number[] = [];
    const chosen = await resolveAtContexts([65536, 32768], async (context) => {
      tried.push(context);
      if (context > 32768) throw new NoFittingModelError("nothing fits", "lower the context");
      return context;
    });
    expect(chosen).toEqual({ resolved: 32768, contextTokens: 32768 });
    expect(tried).toEqual([65536, 32768]);
  });

  it("stops at once on any other failure, and says the last fit failure where none fits", async () => {
    const down = resolveAtContexts([65536, 32768], async () => {
      throw new NoModelError("Ollama is not answering", "start it");
    });
    await expect(down).rejects.toThrow("Ollama is not answering");
    const none = resolveAtContexts([65536, 32768], async (context) => {
      throw new NoFittingModelError(`nothing fits at ${context}`, "install a smaller model");
    });
    await expect(none).rejects.toThrow("nothing fits at 32768");
  });
});
