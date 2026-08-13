import { describe, expect, it } from "vitest";
import { moduleBoundary } from "./index.ts";

describe("core module", () => {
  it("placeholder: holds the boundary open until the real core lands", () => {
    expect(moduleBoundary).toBe("core");
  });
});
