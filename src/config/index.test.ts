import { describe, expect, it } from "vitest";
import { moduleBoundary } from "./index.ts";

describe("config module", () => {
  it("placeholder: holds the boundary open until the real config lands", () => {
    expect(moduleBoundary).toBe("config");
  });
});
