import { describe, expect, it } from "vitest";
import { moduleBoundary } from "./index.ts";

describe("providers module", () => {
  it("placeholder: holds the boundary open until the real providers lands", () => {
    expect(moduleBoundary).toBe("providers");
  });
});
