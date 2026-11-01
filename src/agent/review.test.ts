import { describe, expect, it } from "vitest";
import { noFinding, parseReview } from "./review.ts";

describe("reading a review", () => {
  it("takes a sentence and one bash block as a finding with its check", () => {
    expect(parseReview("half(5) should be 2.\n```bash\nnode -e 'process.exit(1)'\n```")).toEqual({
      kind: "finding",
      finding: "half(5) should be 2.",
      command: "node -e 'process.exit(1)'",
    });
  });

  it("takes the marker alone as no finding, and anything else as unusable", () => {
    expect(parseReview(`Looks right.\n${noFinding}\n`)).toEqual({ kind: "no-finding" });
    expect(parseReview("The change seems incomplete.")).toEqual({ kind: "unusable" });
    expect(parseReview("```bash\n\n```")).toEqual({ kind: "unusable" });
  });
});
