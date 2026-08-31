import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { probeChangedBehaviour } from "./behaviour-probe.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";
import { createMemoryWorkspace } from "./test-doubles.ts";

let outside = "";

beforeEach(async () => {
  outside = await mkdtemp(join(tmpdir(), "swarm-probe-"));
});

afterEach(async () => {
  await rm(outside, { recursive: true, force: true });
});

async function probe(base: Record<string, string>, current: Record<string, string>) {
  const workspace = createMemoryWorkspace({ base, current });
  return await probeChangedBehaviour({
    changes: await workspace.changes(),
    probe: workspace,
    commands: createNodeCommandRunner(createTestClock(1)),
    scratchDirectory: join(outside, "probe"),
    timeoutMs: 30_000,
  });
}

const workingAdd = "export function add(a, b) {\n  return a + b;\n}\n";
const stubbedAdd = "export function add(a, b) {\n  return 0;\n}\n";

describe("a function replaced by a constant", () => {
  it("is flagged, because it answered several ways and now answers one", async () => {
    const result = await probe({ "src/add.mjs": workingAdd }, { "src/add.mjs": stubbedAdd });

    expect(result.flattened.map((one) => one.name)).toEqual(["add"]);
    expect(result.flattened[0]).toMatchObject({ file: "src/add.mjs", candidateOutcomes: 1 });
  }, 60_000);

  it("is flagged when the constant is an empty string, which is as much a stub as zero", async () => {
    const result = await probe(
      { "src/label.mjs": "export function label(x) {\n  return String(x);\n}\n" },
      { "src/label.mjs": "export function label(x) {\n  return '';\n}\n" },
    );

    expect(result.flattened.map((one) => one.name)).toEqual(["label"]);
  }, 60_000);
});

describe("what the probe leaves alone", () => {
  it("says nothing about a function that was always constant", async () => {
    // The false positive the build guide warns about: `return 3` is a stub in one function and
    // a version number in another, and nothing here has to decide which. It did not vary
    // before, so it has lost nothing.
    const result = await probe(
      { "src/version.mjs": "export function version() {\n  return 2;\n}\n" },
      { "src/version.mjs": "export function version() {\n  return 3;\n}\n" },
    );

    expect(result.flattened).toEqual([]);
  }, 60_000);

  it("says nothing about a function that still varies", async () => {
    const result = await probe(
      { "src/add.mjs": workingAdd },
      { "src/add.mjs": "export function add(a, b) {\n  return b + a;\n}\n" },
    );

    expect(result.flattened).toEqual([]);
    expect(result.probed.map((one) => one.name)).toEqual(["add"]);
  }, 60_000);

  it("says nothing about a function taking no arguments, which has nothing to vary", async () => {
    const result = await probe(
      { "src/now.mjs": "let n = 0;\nexport function tick() {\n  n += 1;\n  return n;\n}\n" },
      { "src/now.mjs": "export function tick() {\n  return 1;\n}\n" },
    );

    expect(result.flattened).toEqual([]);
  }, 60_000);

  it("reports a module it could not load as unprobed rather than as measured", async () => {
    // Both versions are written to a scratch directory, so a module importing a sibling does
    // not resolve there. Not measured is a verdict; silence would be a claim.
    const importsASibling =
      'import { helper } from "./helper.mjs";\nexport const f = (x) => helper(x);\n';
    const result = await probe(
      { "src/uses.mjs": importsASibling },
      { "src/uses.mjs": `${importsASibling}// changed\n` },
    );

    expect(result.flattened).toEqual([]);
    expect(result.unprobed.map((one) => one.file)).toEqual(["src/uses.mjs"]);
  }, 60_000);

  it("says nothing about a file with no pair of versions to compare", async () => {
    const result = await probe({}, { "src/new.mjs": workingAdd });

    expect(result.probed).toEqual([]);
    expect(result.unprobed).toEqual([]);
  }, 60_000);
});

describe("a function that became strict rather than constant", () => {
  it("is not flagged, because refusing every input is not answering one way", async () => {
    // Tightening a signature makes the probe see one outcome, and it is a throw. That is
    // ordinary work, and flagging it is the false positive that would make this gate one
    // people route around.
    const result = await probe(
      { "src/take.mjs": "export function take(x) {\n  return String(x);\n}\n" },
      {
        "src/take.mjs":
          "export function take(x) {\n" +
          "  if (typeof x !== 'object' || x === null) throw new TypeError('object required');\n" +
          "  return Object.keys(x).length;\n" +
          "}\n",
      },
    );

    expect(result.flattened).toEqual([]);
    expect(result.probed[0]).toMatchObject({ name: "take", candidateAlwaysThrew: true });
  }, 60_000);
});
