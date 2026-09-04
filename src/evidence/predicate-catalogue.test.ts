import { describe, expect, it } from "vitest";
import { recordTypes } from "./ledger-record.ts";
import {
  type CatalogueEntry,
  catalogueDrift,
  exampleVerifies,
  kindOf,
  predicateCatalogue,
  renderPredicateCatalogue,
} from "./predicate-catalogue.ts";

describe("the predicate catalogue", () => {
  it("has exactly one entry per record type the ledger can hold", () => {
    expect([...new Set(predicateCatalogue.map((entry) => entry.type))].sort()).toEqual(
      [...recordTypes].sort(),
    );
    expect(predicateCatalogue).toHaveLength(recordTypes.length);
  });

  it("names every kind by the shipped verifier's own rule", () => {
    expect(
      kindOf(predicateCatalogue.find((entry) => entry.type === "gate-run") as CatalogueEntry),
    ).toBe("gate-run:tests");
    expect(
      kindOf(predicateCatalogue.find((entry) => entry.type === "claim") as CatalogueEntry),
    ).toBe("claim");
  });

  it("holds every example to the shipped verifier against its sample", () => {
    for (const entry of predicateCatalogue) {
      expect(exampleVerifies(entry), `${entry.type}: ${entry.example}`).toBe(true);
    }
  });

  it("reports no drift against this tree", () => {
    expect(catalogueDrift()).toEqual([]);
  });

  it("names a missing type, a type the ledger lacks, a wrong kind, and a false example", () => {
    const gateRun = predicateCatalogue.find((entry) => entry.type === "gate-run") as CatalogueEntry;
    const drifted: CatalogueEntry[] = [
      ...predicateCatalogue.filter((entry) => entry.type !== "reward" && entry.type !== "gate-run"),
      { ...gateRun, subjectField: null },
      { ...gateRun, type: "escalation", example: 'status == "failed"' },
    ];

    const problems = catalogueDrift(drifted);

    expect(problems).toContain(
      "record type reward has no catalogue entry, so the prompt does not mention it",
    );
    expect(problems).toContain("catalogue names escalation 2 times; one example per kind");
    expect(problems).toContain(
      "gate-run: the verifier names the kind gate-run:tests, the catalogue says gate-run",
    );
    expect(problems.some((problem) => problem.includes("does not verify against its sample"))).toBe(
      true,
    );
    expect(catalogueDrift(predicateCatalogue, [...recordTypes, "made-up"])).toContain(
      "record type made-up has no catalogue entry, so the prompt does not mention it",
    );
  });

  it("renders as one line the prompt can carry, with every kind on it", () => {
    const rendered = renderPredicateCatalogue();

    expect(rendered.includes("\n")).toBe(false);
    expect(rendered).toContain("gate-run:<gateId>");
    expect(rendered).toContain("tool-call:<toolName>");
    for (const type of recordTypes) {
      expect(rendered).toContain(type);
    }
  });
});
