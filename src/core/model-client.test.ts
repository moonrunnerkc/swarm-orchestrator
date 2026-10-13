import { describe, expect, it } from "vitest";
import { describeUnknownError } from "./model-client.ts";

describe("describing an unknown error", () => {
  it("follows an Error's cause chain and its codes", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    expect(describeUnknownError(new Error("fetch failed", { cause }))).toBe(
      "fetch failed, caused by connect ECONNREFUSED, caused by ECONNREFUSED",
    );
  });

  it("reads a local server's error body instead of printing [object Object]", () => {
    expect(
      describeUnknownError({
        error: { message: "This model's maximum context length is 32768 tokens", type: "invalid" },
      }),
    ).toBe("This model's maximum context length is 32768 tokens");
    expect(describeUnknownError({ message: "upstream closed", status: 502 })).toBe(
      "upstream closed, status 502",
    );
    expect(describeUnknownError({ statusCode: 429, statusText: "Too Many Requests" })).toBe(
      "status 429, Too Many Requests",
    );
  });

  it("falls back to bounded JSON, and names a value that carries nothing", () => {
    expect(describeUnknownError({ detail: { reason: "x" } })).toBe('{"detail":{"reason":"x"}}');
    expect(describeUnknownError({})).toBe("an error carrying no message");
    expect(describeUnknownError({ blob: "y".repeat(1000) }).length).toBeLessThan(420);
    expect(describeUnknownError("plain text")).toBe("plain text");
    expect(describeUnknownError(42)).toBe("42");
  });

  it("follows a plain object's own cause", () => {
    expect(
      describeUnknownError({ message: "request failed", cause: { message: "socket hang up" } }),
    ).toBe("request failed, caused by socket hang up");
  });
});
