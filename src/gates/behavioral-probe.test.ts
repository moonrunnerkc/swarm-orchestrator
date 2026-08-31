import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { constantReturnFindings, exportedFunctionNames } from "./behavioral-probe.ts";
import { createConstantReturnGate, createFileConstantReturnProbe } from "./constant-return-gate.ts";
import type { GateContext, GateDefinition } from "./gate-definition.ts";
import { inspectionGates } from "./inspection-gates.ts";
import { measureTestFile } from "./measures.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";
import { createMemoryWorkspace } from "./test-doubles.ts";

/**
 * Fixture for the constant-return stub, committed before any probe exists so that closure is
 * provable. Named in docs/build-guide.md section 7.1.
 *
 * The shape: an implementation is replaced by a constant, and the test that covered it is
 * rewritten to expect the constant. No placeholder marker is introduced, no ratchet numeric
 * moves, and every gate goes green over a function that stopped doing anything.
 *
 * The first three assertions were committed describing what the tree did before the probe
 * existed, and are unchanged: every one of them is still true, because the probe closes none
 * of them. What closes the gap is a measurement no static check can make, and the cases below
 * the fixture are that measurement.
 */

const workingSource = [
  "export function discount(total, rate) {",
  "  return total - total * rate;",
  "}",
].join("\n");

const stubbedSource = ["export function discount(total, rate) {", "  return 0;", "}"].join("\n");

const workingTest =
  "it('discounts', () => { expect(discount(100, 0.1)).toBe(90); expect(discount(50, 0.5)).toBe(25); });";
const rewrittenTest =
  "it('discounts', () => { expect(discount(100, 0.1)).toBe(0); expect(discount(50, 0.5)).toBe(0); });";

async function inspectAll(
  base: Record<string, string>,
  current: Record<string, string>,
): Promise<Record<string, string>> {
  const probe = createMemoryWorkspace({ base, current });
  const context: GateContext = {
    workspaceRoot: "/workspace",
    changes: await probe.changes(),
    fileSet: {
      declared: Object.keys(current),
      amendments: [],
      allowed: new Set(Object.keys(current)),
      wasDeclared: true,
      editedBeforeAuthorized: [],
    },
    budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
    probe,
  };

  const statuses: Record<string, string> = {};
  for (const gate of inspectionGates as readonly GateDefinition[]) {
    if (gate.source.kind !== "inspection") {
      continue;
    }
    statuses[gate.id] = gate.parse(await gate.source.inspect(context)).status;
  }
  return statuses;
}

describe("gap: an implementation replaced by a constant return", () => {
  it("introduces no placeholder marker, so every inspection gate goes green", async () => {
    const statuses = await inspectAll(
      { "src/pricing.ts": workingSource, "src/pricing.test.ts": workingTest },
      { "src/pricing.ts": stubbedSource, "src/pricing.test.ts": rewrittenTest },
    );

    expect(statuses.placeholder).toBe("passed");
    expect(statuses["secret-scan"]).toBe("passed");
    expect(statuses["file-set"]).toBe("passed");
  });

  it("moves no ratchet numeric: the same test count and the same assertion count", () => {
    const before = measureTestFile(workingTest);
    const after = measureTestFile(rewrittenTest);

    expect(after.tests).toBe(before.tests);
    expect(after.assertions).toBe(before.assertions);
    expect(after.skips).toBe(before.skips);
  });

  it("is the shape a probe would have to tell from a function that was always constant", () => {
    // The false positive any closure has to avoid. `version` returns the same thing for every
    // input because that is what it is for, and nothing textual separates it from the stub.
    const alwaysConstant = ["export function version(_input) {", "  return 3;", "}"].join("\n");

    expect(alwaysConstant).toContain("return 3;");
    expect(stubbedSource).toContain("return 0;");
  });
});

describe("what the probe reads off two runs", () => {
  it("flags a function that varied before the change and does not after", () => {
    const findings = constantReturnFindings(
      "src/pricing.ts",
      {
        module: "base",
        failure: null,
        exports: [{ name: "discount", arity: 2, distinct: 6, called: 13, threw: 0 }],
      },
      {
        module: "submitted",
        failure: null,
        exports: [{ name: "discount", arity: 2, distinct: 1, called: 13, threw: 0 }],
      },
    );

    expect(findings).toEqual([
      { path: "src/pricing.ts", name: "discount", arity: 2, baseDistinct: 6 },
    ]);
  });

  it("says nothing about a function that was already constant", () => {
    // The committed false positive, as a measurement: nothing about its variance changed.
    expect(
      constantReturnFindings(
        "src/version.ts",
        {
          module: "base",
          failure: null,
          exports: [{ name: "version", arity: 1, distinct: 1, called: 13, threw: 0 }],
        },
        {
          module: "submitted",
          failure: null,
          exports: [{ name: "version", arity: 1, distinct: 1, called: 13, threw: 0 }],
        },
      ),
    ).toEqual([]);
  });

  it("says nothing about a function taking no input, which cannot vary with one", () => {
    expect(
      constantReturnFindings(
        "src/now.ts",
        {
          module: "base",
          failure: null,
          exports: [{ name: "seed", arity: 0, distinct: 4, called: 13, threw: 0 }],
        },
        {
          module: "submitted",
          failure: null,
          exports: [{ name: "seed", arity: 0, distinct: 1, called: 13, threw: 0 }],
        },
      ),
    ).toEqual([]);
  });

  it("says nothing about a function that threw on every input, which is a different finding", () => {
    expect(
      constantReturnFindings(
        "src/broken.ts",
        {
          module: "base",
          failure: null,
          exports: [{ name: "parse", arity: 1, distinct: 5, called: 13, threw: 0 }],
        },
        {
          module: "submitted",
          failure: null,
          exports: [{ name: "parse", arity: 1, distinct: 1, called: 13, threw: 13 }],
        },
      ),
    ).toEqual([]);
  });

  it("says nothing when either module failed to load, rather than reading the failure as constancy", () => {
    expect(
      constantReturnFindings(
        "src/pricing.ts",
        { module: "base", failure: "Cannot find module", exports: [] },
        {
          module: "submitted",
          failure: null,
          exports: [{ name: "discount", arity: 2, distinct: 1, called: 13, threw: 0 }],
        },
      ),
    ).toEqual([]);
  });

  it("probes the module's exports, because the stub edits a body and not the export line", () => {
    expect(
      exportedFunctionNames(
        [
          "export function discount(total, rate) {",
          "  return 0;",
          "}",
          "export const label = (x) => x;",
          "const untouched = 1;",
        ].join("\n"),
      ),
    ).toEqual(["discount", "label"]);
  });
});

describe("the probe against a real module", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "swarm-probe-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function probeChange(
    path: string,
    base: string,
    submitted: string,
  ): Promise<{ status: string; detail: string; measures: Record<string, number> }> {
    const workspaceRoot = join(root, "workspace");
    await mkdir(dirname(join(workspaceRoot, path)), { recursive: true });
    await writeFile(join(workspaceRoot, path), submitted, "utf8");

    const memory = createMemoryWorkspace({
      base: { [path]: base },
      current: { [path]: submitted },
    });
    const context: GateContext = {
      workspaceRoot,
      changes: await memory.changes(),
      fileSet: {
        declared: [path],
        amendments: [],
        allowed: new Set([path]),
        wasDeclared: true,
        editedBeforeAuthorized: [],
      },
      budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
      probe: memory,
    };

    const gate = createConstantReturnGate(
      createFileConstantReturnProbe({
        commands: createNodeCommandRunner(createTestClock()),
        scriptDirectory: join(root, "session", "probe"),
        timeoutMs: 30_000,
      }),
    );
    if (gate.source.kind !== "inspection") {
      throw new Error("the constant-return gate is an inspection");
    }
    const reading = gate.parse(await gate.source.inspect(context));
    return { status: reading.status, detail: reading.detail, measures: { ...reading.measures } };
  }

  it("catches the stub the static gates cannot, by running both versions", async () => {
    const reading = await probeChange("src/pricing.mjs", workingSource, stubbedSource);

    expect(reading.status).toBe("failed");
    expect(reading.measures.constantReturns).toBe(1);
    expect(reading.detail).toContain("discount");
    // Advisory, so it reports and does not block: what the measurement means is a person's.
    expect(reading.detail).toContain("does not block");
  });

  it("leaves a function that was always constant alone", async () => {
    const before = "export function version(_input) {\n  return 3;\n}\n";
    const after = "export function version(_input) {\n  return 4;\n}\n";

    const reading = await probeChange("src/version.mjs", before, after);

    expect(reading.status).toBe("passed");
    expect(reading.measures.constantReturns).toBe(0);
  });

  it("leaves a refactor that keeps the behaviour alone", async () => {
    const before = "export function twice(x) {\n  return x + x;\n}\n";
    const after = "export function twice(x) {\n  return 2 * x;\n}\n";

    const reading = await probeChange("src/twice.mjs", before, after);

    expect(reading.status).toBe("passed");
  });

  it("removes the copy of the base version it wrote beside the file", async () => {
    await probeChange("src/pricing.mjs", workingSource, stubbedSource);

    const { readdir } = await import("node:fs/promises");
    expect(await readdir(join(root, "workspace", "src"))).toEqual(["pricing.mjs"]);
  });

  it("reports not-applicable where nothing was configured to run one", async () => {
    const gate = createConstantReturnGate(null);
    if (gate.source.kind !== "inspection") {
      throw new Error("the constant-return gate is an inspection");
    }
    const memory = createMemoryWorkspace({ base: {}, current: {} });
    const reading = gate.parse(
      await gate.source.inspect({
        workspaceRoot: "/workspace",
        changes: await memory.changes(),
        fileSet: {
          declared: [],
          amendments: [],
          allowed: new Set(),
          wasDeclared: true,
          editedBeforeAuthorized: [],
        },
        budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
        probe: memory,
      }),
    );

    expect(reading.status).toBe("not-applicable");
  });
});
