import { describe, expect, it } from "vitest";
import { moduleBoundary } from "./index.ts";

describe("tui module", () => {
  it("placeholder: holds the boundary open until the real tui lands", () => {
    expect(moduleBoundary).toBe("tui");
  });
});
