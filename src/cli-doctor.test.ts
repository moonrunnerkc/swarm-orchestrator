import { describe, expect, it } from "vitest";
import { doctorCommand } from "./cli-doctor.ts";

describe("swarm doctor --models", () => {
  it("refuses a context that is not a positive whole number before probing anything", async () => {
    for (const context of ["abc", "0", "-5", "1.5"]) {
      await expect(doctorCommand(["--models", `--context=${context}`])).rejects.toThrow(
        "--context needs a positive whole number",
      );
    }
  });
});
