import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GateObservation } from "./gate-definition.ts";
import { lineHitsUnder } from "./independent-verification.ts";
import type { OracleCoveragePlan } from "./oracle-instrumentation.ts";

/**
 * Every way a coverage reading can fail to exist, each held to reading as no measurement.
 *
 * `null` from here is what `measureOracleReach` reports as `unmeasured`. None of these may come
 * back as an empty set of hits, because an empty set is a measurement: it says the oracle loaded
 * nothing the patch changed, and reach refuses on it.
 */
const ran = (overrides: Partial<GateObservation> = {}): GateObservation => ({
  exitCode: 0,
  stdout: "",
  stderr: "",
  durationMs: 1,
  unavailable: null,
  ...overrides,
});

let checkout: string;
let destination: string;

beforeEach(async () => {
  checkout = await mkdtemp(join(tmpdir(), "reach-abstention-checkout-"));
  destination = await mkdtemp(join(tmpdir(), "reach-abstention-coverage-"));
  await writeFile(join(checkout, "clamp.mjs"), "export const clamp = (v) => v;\n");
});

afterEach(async () => {
  await rm(checkout, { recursive: true, force: true });
  await rm(destination, { recursive: true, force: true });
});

const changed = [{ path: "clamp.mjs" }];
const answering = (observation: GateObservation, effect: () => Promise<void> = async () => {}) => ({
  run: async () => {
    await effect();
    return observation;
  },
  runVouched: async () => {
    await effect();
    return observation;
  },
});

const lcovFor = (path: string, hits: number) =>
  `SF:${path}\nDA:1,${hits}\nLF:1\nLH:${hits > 0 ? 1 : 0}\nend_of_record\n`;

describe("node's own lcov arm", () => {
  const plan: OracleCoveragePlan = { kind: "node-lcov", setup: "", argv: ["node", "--test"] };

  it("reads the hits where the instrumented run passed and reported", async () => {
    const hits = await lineHitsUnder(
      plan,
      checkout,
      changed,
      answering(ran({ stderr: lcovFor("clamp.mjs", 2) })),
      1000,
    );
    expect(hits).toEqual({ "clamp.mjs": { 1: 2 } });
  });

  it("abstains where the instrumented run failed, since it is not the run that was judged", async () => {
    const commands = answering(ran({ exitCode: 1, stderr: lcovFor("clamp.mjs", 0) }));
    expect(await lineHitsUnder(plan, checkout, changed, commands, 1000)).toBeNull();
  });

  it("abstains where the run reported no coverage at all", async () => {
    expect(await lineHitsUnder(plan, checkout, changed, answering(ran()), 1000)).toBeNull();
  });

  it("abstains where the command could not be started", async () => {
    const commands = answering(ran({ unavailable: "node is not on the path" }));
    expect(await lineHitsUnder(plan, checkout, changed, commands, 1000)).toBeNull();
  });
});

describe("the V8 arm", () => {
  const plan = (): OracleCoveragePlan => ({
    kind: "v8",
    setup: "",
    command: "mocha",
    destination,
  });
  const v8Report = (endOffset: number) =>
    JSON.stringify({
      result: [
        {
          url: `file://${join(checkout, "clamp.mjs")}`,
          functions: [{ ranges: [{ startOffset: 0, endOffset, count: 1 }] }],
        },
      ],
    });

  it("reads the hits of a file V8 compiled as written", async () => {
    const commands = answering(ran(), () =>
      writeFile(join(destination, "coverage-1.json"), v8Report(30)),
    );
    expect(await lineHitsUnder(plan(), checkout, changed, commands, 1000)).toEqual({
      "clamp.mjs": { 1: 1 },
    });
  });

  it("abstains where the runner wrote no coverage file", async () => {
    expect(await lineHitsUnder(plan(), checkout, changed, answering(ran()), 1000)).toBeNull();
  });

  it("abstains where the coverage directory is gone", async () => {
    const commands = answering(ran(), () => rm(destination, { recursive: true, force: true }));
    expect(await lineHitsUnder(plan(), checkout, changed, commands, 1000)).toBeNull();
  });

  it("abstains where the instrumented run failed", async () => {
    const commands = answering(ran({ exitCode: 2 }), () =>
      writeFile(join(destination, "coverage-1.json"), v8Report(30)),
    );
    expect(await lineHitsUnder(plan(), checkout, changed, commands, 1000)).toBeNull();
  });

  it("abstains where a transforming runner left offsets past the end of the file", async () => {
    const commands = answering(ran(), () =>
      writeFile(join(destination, "coverage-1.json"), v8Report(5000)),
    );
    expect(await lineHitsUnder(plan(), checkout, changed, commands, 1000)).toBeNull();
  });

  it("measures a file the run never loaded as not loaded, which is a reading", async () => {
    const commands = answering(ran(), () =>
      writeFile(join(destination, "coverage-1.json"), JSON.stringify({ result: [] })),
    );
    expect(await lineHitsUnder(plan(), checkout, changed, commands, 1000)).toEqual({});
  });
});

describe("the runner's own lcov file", () => {
  const plan = (): OracleCoveragePlan => ({
    kind: "lcov-file",
    setup: "",
    command: "jest --coverage",
    file: join(destination, "lcov.info"),
  });

  it("reads an absolute section name as the patch would write it", async () => {
    const commands = answering(ran(), () =>
      writeFile(join(destination, "lcov.info"), lcovFor(join(checkout, "clamp.mjs"), 0)),
    );
    expect(await lineHitsUnder(plan(), checkout, changed, commands, 1000)).toEqual({
      "clamp.mjs": { 1: 0 },
    });
  });

  it("abstains where no report was written", async () => {
    expect(await lineHitsUnder(plan(), checkout, changed, answering(ran()), 1000)).toBeNull();
  });

  it("abstains where the report is empty", async () => {
    const commands = answering(ran(), () => writeFile(join(destination, "lcov.info"), ""));
    expect(await lineHitsUnder(plan(), checkout, changed, commands, 1000)).toBeNull();
  });

  it("abstains where the instrumented run failed after writing a report", async () => {
    const commands = answering(ran({ exitCode: 1 }), async () => {
      await mkdir(destination, { recursive: true });
      await writeFile(join(destination, "lcov.info"), lcovFor("clamp.mjs", 0));
    });
    expect(await lineHitsUnder(plan(), checkout, changed, commands, 1000)).toBeNull();
  });
});
