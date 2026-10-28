import { describe, expect, it } from "vitest";
import { mutateLine } from "./mutation.ts";

describe("one mutant per line", () => {
  it("flips the first comparison it finds", () => {
    expect(mutateLine("  if (a === b) return 1;")).toEqual({
      text: "  if (a !== b) return 1;",
      operator: "=== to !==",
    });
  });

  it("leaves operators inside strings and comments alone", () => {
    expect(mutateLine('  const label = "a && b"; // x || y')).toBeNull();
  });

  it("swaps min and max, and bumps a literal", () => {
    expect(mutateLine("  return Math.min(high, value);")?.text).toBe(
      "  return Math.max(high, value);",
    );
    expect(mutateLine("  const size = 8;")?.text).toBe("  const size = 9;");
  });

  it("drops a returned value as a last resort, in the file's language", () => {
    expect(mutateLine("  return value")?.text).toBe("  return undefined;");
    expect(mutateLine("    return value", true)?.text).toBe("    return None");
  });

  it("does not mutate imports or lines without an operator", () => {
    expect(mutateLine('import { a } from "./a.js";')).toBeNull();
    expect(mutateLine("  doThing(value);")).toBeNull();
  });
});
