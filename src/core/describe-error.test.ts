import { describe, expect, it } from "vitest";
import { describeUnknownError } from "./model-client.ts";

describe("what a failed call is reported as", () => {
  it("carries the cause, which is where the reason actually is", () => {
    // A local endpoint closing a connection reaches fetch as an Error whose entire message is
    // "terminated". A run recorded exactly that, three times, and neither the person reading it
    // nor the retry beside it could tell a timeout from a dropped socket.
    const socket = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
    const reported = describeUnknownError(new TypeError("terminated", { cause: socket }));

    expect(reported).toContain("terminated");
    expect(reported).toContain("other side closed");
    expect(reported).toContain("UND_ERR_SOCKET");
  });

  it("says the plain thing when there is no cause under it", () => {
    expect(describeUnknownError(new Error("connection refused"))).toBe("connection refused");
    expect(describeUnknownError("a string nobody wrapped")).toBe("a string nobody wrapped");
  });

  it("stops rather than spinning on a cause that points at itself", () => {
    const looping = new Error("round");
    (looping as { cause?: unknown }).cause = looping;

    expect(describeUnknownError(looping)).toContain("round");
  });
});
