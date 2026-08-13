import { describe, expect, it } from "vitest";
import { moduleBoundary } from "./index.ts";

describe("select module", () => {
  it("placeholder: holds the boundary open until the real select lands", () => {
    expect(moduleBoundary).toBe("select");
  });
});
