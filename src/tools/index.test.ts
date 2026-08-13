import { describe, expect, it } from "vitest";
import { moduleBoundary } from "./index.ts";

describe("tools module", () => {
  it("placeholder: holds the boundary open until the real tools lands", () => {
    expect(moduleBoundary).toBe("tools");
  });
});
