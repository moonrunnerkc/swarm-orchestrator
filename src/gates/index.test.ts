import { describe, expect, it } from "vitest";
import { moduleBoundary } from "./index.ts";

describe("gates module", () => {
  it("placeholder: holds the boundary open until the real gates lands", () => {
    expect(moduleBoundary).toBe("gates");
  });
});
