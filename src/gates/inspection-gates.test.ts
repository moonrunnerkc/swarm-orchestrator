import { describe, expect, it } from "vitest";
import { emptyFileSet, type FileSetState } from "./file-set.ts";
import type { GateContext, GateDefinition } from "./gate-definition.ts";
import {
  diffBudgetGate,
  fileSetGate,
  placeholderGate,
  secretScanGate,
} from "./inspection-gates.ts";
import { createMemoryWorkspace } from "./test-doubles.ts";

async function readGate(
  gate: GateDefinition,
  base: Record<string, string>,
  current: Record<string, string>,
  fileSet: FileSetState = declared(Object.keys({ ...base, ...current })),
): Promise<{ status: string; detail: string; measures: Record<string, number> }> {
  const probe = createMemoryWorkspace({ base, current });
  const context: GateContext = {
    workspaceRoot: "/workspace",
    changes: await probe.changes(),
    fileSet,
    budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
    probe,
  };
  if (gate.source.kind !== "inspection") {
    throw new Error("this test only drives inspection gates");
  }
  const reading = gate.parse(await gate.source.inspect(context));
  return { status: reading.status, detail: reading.detail, measures: { ...reading.measures } };
}

function declared(files: readonly string[]): FileSetState {
  return {
    declared: [...files],
    amendments: [],
    allowed: new Set(files),
    wasDeclared: true,
  };
}

describe("the placeholder gate", () => {
  it("blocks a TODO introduced by the change", async () => {
    const reading = await readGate(
      placeholderGate,
      { "src/a.ts": "export const a = 1;" },
      { "src/a.ts": "// TODO: finish this\nexport const a = 1;" },
    );

    expect(reading.status).toBe("failed");
    expect(reading.measures.placeholdersIntroduced).toBe(1);
    expect(reading.detail).toContain("src/a.ts:1");
  });

  it("blocks the other marker spellings too, with no exemption for scaffolding", async () => {
    for (const marker of [
      "// FIXME: later",
      "# XXX broken",
      "  * TBD: decide this",
      "raise NotImplementedError",
      "  todo!()",
      "  throw new Error('not implemented');",
    ]) {
      const reading = await readGate(
        placeholderGate,
        { "src/a.py": "x = 1" },
        {
          "src/a.py": `${marker}\nx = 1`,
        },
      );
      expect({ marker, status: reading.status }).toEqual({ marker, status: "failed" });
    }
  });

  it("reads an annotation as an annotation only in comment position", async () => {
    // A line that mentions the marker as data is prose, not a placeholder. Without this the
    // gate flags its own pattern table, and a gate people route around checks nothing.
    const passing = await readGate(
      placeholderGate,
      { "src/a.ts": "export const a = 1;" },
      { "src/a.ts": "export const markers = [/TODO/, /FIXME/];\nexport const a = 1;" },
    );
    expect(passing.status).toBe("passed");

    const failing = await readGate(
      placeholderGate,
      { "src/a.ts": "export const a = 1;" },
      { "src/a.ts": "export const a = 1; // TODO: revisit" },
    );
    expect(failing.status).toBe("failed");
  });

  it("blocks a marker that only differs from the literal one by case", async () => {
    for (const marker of ["// todo: finish this", "// FiXmE later", "# xxx broken", "// tbd"]) {
      const reading = await readGate(
        placeholderGate,
        { "src/a.ts": "export const a = 1;" },
        { "src/a.ts": `${marker}\nexport const a = 1;` },
      );
      expect({ marker, status: reading.status }).toEqual({ marker, status: "failed" });
    }
  });

  it("blocks a marker split by a character that renders as nothing", async () => {
    // Zero-width space, zero-width non-joiner, word joiner, soft hyphen: each one carries no
    // meaning in source and is here only to break a literal match.
    for (const invisible of ["​", "‌", "⁠", "­"]) {
      const marker = `// TO${invisible}DO: finish this`;
      const reading = await readGate(
        placeholderGate,
        { "src/a.ts": "export const a = 1;" },
        { "src/a.ts": `${marker}\nexport const a = 1;` },
      );
      expect({ escaped: JSON.stringify(marker), status: reading.status }).toEqual({
        escaped: JSON.stringify(marker),
        status: "failed",
      });
    }
  });

  it("still reads a folded marker as an annotation only in comment position", async () => {
    const reading = await readGate(
      placeholderGate,
      { "src/a.ts": "export const a = 1;" },
      { "src/a.ts": "export const markers = [/todo/i, /fixme/i];\nexport const a = 1;" },
    );

    expect(reading.status).toBe("passed");
  });

  it("does not read an ordinary word as a marker because it contains one", async () => {
    for (const line of ["// hacking around the upstream bug", "// the photodocumentation step"]) {
      const reading = await readGate(
        placeholderGate,
        { "src/a.ts": "export const a = 1;" },
        { "src/a.ts": `${line}\nexport const a = 1;` },
      );
      expect({ line, status: reading.status }).toEqual({ line, status: "passed" });
    }
  });

  it("leaves a marker that was already there alone, since this change did not introduce it", async () => {
    const reading = await readGate(
      placeholderGate,
      { "src/a.ts": "// TODO: someone else's\nexport const a = 1;" },
      { "src/a.ts": "// TODO: someone else's\nexport const a = 2;" },
    );

    expect(reading.status).toBe("passed");
    expect(reading.measures.placeholdersIntroduced).toBe(0);
  });
});

describe("the file-set gate", () => {
  it("blocks a change to a file outside the declared set", async () => {
    const reading = await readGate(
      fileSetGate,
      { "src/a.ts": "1", "src/b.ts": "1" },
      { "src/a.ts": "2", "src/b.ts": "2" },
      declared(["src/a.ts"]),
    );

    expect(reading.status).toBe("failed");
    expect(reading.detail).toContain("src/b.ts");
    expect(reading.measures.filesOutsideDeclaredSet).toBe(1);
  });

  it("passes once an amendment has widened the set to cover the file", async () => {
    const reading = await readGate(
      fileSetGate,
      { "src/a.ts": "1", "src/b.ts": "1" },
      { "src/a.ts": "2", "src/b.ts": "2" },
      {
        declared: ["src/a.ts"],
        amendments: [{ added: ["src/b.ts"], reason: "shared helper", record: "sha256:x" }],
        allowed: new Set(["src/a.ts", "src/b.ts"]),
        wasDeclared: true,
      },
    );

    expect(reading.status).toBe("passed");
    expect(reading.measures.fileSetAmendments).toBe(1);
  });

  it("blocks editing when nothing was declared at all", async () => {
    const reading = await readGate(
      fileSetGate,
      { "src/a.ts": "1" },
      { "src/a.ts": "2" },
      emptyFileSet,
    );

    expect(reading.status).toBe("failed");
    expect(reading.detail).toContain("no file set was declared before editing");
  });

  it("has nothing to rule on when nothing changed", async () => {
    const reading = await readGate(
      fileSetGate,
      { "src/a.ts": "1" },
      { "src/a.ts": "1" },
      emptyFileSet,
    );

    expect(reading.status).toBe("passed");
  });
});

describe("the secret scan gate", () => {
  it("blocks credential material in an added line and names only the pattern", async () => {
    const reading = await readGate(
      secretScanGate,
      { ".config": "" },
      { ".config": "AWS_SECRET=AKIAIOSFODNN7EXAMPLE" },
    );

    expect(reading.status).toBe("failed");
    expect(reading.measures.secretMatches).toBeGreaterThan(0);
    expect(reading.detail).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("passes an ordinary change", async () => {
    const reading = await readGate(secretScanGate, { "src/a.ts": "1" }, { "src/a.ts": "2" });

    expect(reading.status).toBe("passed");
  });

  it("does not block ordinary code that merely names a key or a token", async () => {
    // These all match the write-time scrub, which is fail-safe and redacts them anyway. A
    // blocking gate is not fail-safe, so it asks for a value shaped like a credential.
    for (const line of [
      "createElement(Text, { key: gate.gateId }, label)",
      "budget: { maxTokens: 1_000_000 }",
      "signingKey: createEphemeralSigningKey(),",
      "export const secretScanGate: GateDefinition = {",
    ]) {
      const reading = await readGate(secretScanGate, { "src/a.ts": "" }, { "src/a.ts": line });
      expect({ line, status: reading.status }).toEqual({ line, status: "passed" });
    }
  });

  it("still blocks the credential shapes a real key takes", async () => {
    for (const line of [
      "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY",
      "API_TOKEN: ghp_16C7e42F292c6912E7710c838347Ae178B4a",
      "password = 8f14e45fceea167a5a36dedd4bea2543",
    ]) {
      const reading = await readGate(secretScanGate, { "src/a.ts": "" }, { "src/a.ts": line });
      expect({ line, status: reading.status }).toEqual({ line, status: "failed" });
    }
  });

  it("blocks a credential whose value is nothing but digits", async () => {
    for (const line of ["PIN=482917", "API_KEY=12345678", "accountNumber=123456789012"]) {
      const reading = await readGate(secretScanGate, { ".config": "" }, { ".config": line });
      expect({ line, status: reading.status }).toEqual({ line, status: "failed" });
    }
  });

  it("passes a measurement whose key happens to carry a credential word", async () => {
    for (const line of [
      "  outputTokensPerSecond: 129.90418363640293,",
      '  "outputTokens": 1482917,',
      "  budget: { maxTokens: 1_000_000 },",
    ]) {
      const reading = await readGate(secretScanGate, { "src/a.ts": "" }, { "src/a.ts": line });
      expect({ line, status: reading.status }).toEqual({ line, status: "passed" });
    }
  });
});

describe("the diff budget gate", () => {
  it("is advisory, and says over budget without blocking", async () => {
    const current: Record<string, string> = {};
    for (let index = 0; index < 20; index += 1) {
      current[`src/file-${index}.ts`] = "export const value = 1;";
    }

    const reading = await readGate(diffBudgetGate, {}, current);

    expect(diffBudgetGate.severity).toBe("advisory");
    expect(reading.status).toBe("failed");
    expect(reading.detail).toContain("This does not block");
    expect(reading.detail).toContain("justification claim");
    expect(reading.measures.changedFiles).toBe(20);
  });

  it("passes a change inside its budget", async () => {
    const reading = await readGate(diffBudgetGate, { "src/a.ts": "1" }, { "src/a.ts": "2" });

    expect(reading.status).toBe("passed");
    expect(reading.measures.addedLines).toBe(1);
  });
});
