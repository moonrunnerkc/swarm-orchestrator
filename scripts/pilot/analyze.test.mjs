import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  analysisOf,
  analyzeRecord,
  armSummary,
  normalizeCommand,
  readStage,
  stageAGate,
  stageBGate,
} from "./analyze.mjs";

const digestOf = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

const tasks = [
  { id: "repo-bugfix-thing", workType: "bugfix", projectTest: ["npm", "test"] },
  { id: "repo-feature-thing", workType: "feature", projectTest: ["npm", "run", "test-node"] },
];
const budgets = { wallMsPerInvocation: 19 * 60_000, wallGraceMs: 60_000, maxCorrections: 2 };

/** A Swarm stdout whose planned tests gate is `gate`, with the result line the analyzer reads. */
const swarmStdout = (gate, acceptable = true, extra = "") =>
  [
    "preflight: every sealed check fails on the base",
    `plan: tests (blocking): ${gate}`,
    "step 1: calling local:model",
    extra,
    JSON.stringify({
      schema: "swarm.event.v1",
      runId: "run-1",
      event: { type: "stopped", reason: "completed", steps: 3, tokensUsed: 1000 },
    }),
    JSON.stringify({
      schema: "swarm.result.v1",
      runId: "run-1",
      verdict: { acceptable, reasons: { assessment: acceptable ? "accepted" : "escalated" } },
      bundleDirectory: "/nowhere/bundle",
      exitCode: acceptable ? 0 : 1,
    }),
    "the run took 2 min, 3 steps, 1,000 tokens",
  ].join("\n");

const opencodeStdout = (text = "Done. The change is in place and tests pass.") =>
  [
    JSON.stringify({ type: "step_start" }),
    JSON.stringify({ type: "text", part: { type: "text", text } }),
    JSON.stringify({
      type: "step_finish",
      part: { type: "step-finish", tokens: { input: 900, output: 100 } },
    }),
  ].join("\n");

function record(
  manifestDigest,
  overrides = {},
  stdout = swarmStdout("npm run --loglevel=error test"),
) {
  const base = {
    schema: "swarm-ordinary-comparison.record.v1",
    manifestDigest,
    task: "repo-bugfix-thing",
    arm: "swarm",
    order: 0,
    startedAt: "2026-10-15T01:00:00.000Z",
    endedAt: "2026-10-15T01:10:00.000Z",
    host: { platform: "darwin", arch: "arm64", node: "v24.15.0" },
    versions: {
      swarmRevision: "abc",
      opencode: "1.14.48",
      model: "qwen3.8:27b",
      endpoint: "http://127.0.0.1:8000/v1",
      endpointInstance: "1 x",
    },
    preparation: { wallMs: 30_000, ok: true, detail: "" },
    invocations: [
      {
        kind: "initial",
        correction: 0,
        argv: ["node"],
        exitCode: 0,
        signal: null,
        wallMs: 300_000,
        stdoutDigest: digestOf(stdout),
        stderrDigest: digestOf(""),
        tokens: 1000,
        claimedSuccess: true,
        visible: { checkExit: 0, projectTestExit: 0, passed: true, detailDigest: digestOf("") },
      },
    ],
    corrections: 0,
    resolvedVisible: true,
    finalPatchDigest: digestOf("patch"),
    finalPatchBytes: 5,
    hidden: { verdict: "pass", basis: "all passed", detailDigest: digestOf("") },
    oracleExposure: "no mention of the sealed commit or mirror in 1 evidence director(ies)",
    totals: { agentWallMs: 300_000, tokens: 1000, tokensUnknownInvocations: 0 },
    infrastructureFailure: null,
    notes: [],
  };
  return {
    record: { ...base, ...overrides },
    blobs: { [digestOf(stdout)]: stdout, [digestOf("")]: "", [digestOf("patch")]: "patch" },
  };
}

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** An evidence directory: the manifest, the records named by cell, and the blobs compressed under their digests. */
function evidence({ launches, records, blobs = true, corrupt = [], extraFiles = {} }) {
  const root = mkdtempSync(join(tmpdir(), "pilot-evidence-"));
  roots.push(root);
  const manifest = {
    schema: "swarm-ordinary-comparison.manifest.v1",
    pins: {},
    budgets,
    tasks,
    launches,
  };
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(root, "manifest.json"), bytes);
  mkdirSync(join(root, "records"));
  mkdirSync(join(root, "blobs"));
  const digest = digestOf(bytes);
  const all = {};
  for (const build of records) {
    const { record: one, blobs: cited } = build(digest);
    writeFileSync(join(root, "records", `${one.task}.${one.arm}.json`), JSON.stringify(one));
    Object.assign(all, cited);
  }
  if (blobs)
    for (const [cited, text] of Object.entries(all))
      writeFileSync(
        join(root, "blobs", `${cited.slice(7)}.gz`),
        gzipSync(Buffer.from(corrupt.includes(cited) ? `${text} corrupted` : text)),
      );
  for (const [path, text] of Object.entries(extraFiles)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), path.endsWith(".gz") ? gzipSync(Buffer.from(text)) : text);
  }
  return { root, digest };
}

const fourLaunches = [
  { task: "repo-bugfix-thing", arm: "swarm", order: 0 },
  { task: "repo-bugfix-thing", arm: "opencode", order: 1 },
  { task: "repo-feature-thing", arm: "swarm", order: 2 },
  { task: "repo-feature-thing", arm: "opencode", order: 3 },
];

describe("analyzeRecord keeps a correct patch apart from a delivered task", () => {
  it("does not deliver a Swarm run whose stdout is not in the evidence, even when the oracle passed", () => {
    const { record: one } = record(digestOf("m"));
    const row = analyzeRecord(one);
    expect(row.correctPatch).toBe(true);
    expect(row.delivered).toBe(false);
    expect(row.claim).toBe("unreadable");
  });

  it("reports exit 1 as a reported non-acceptance, never a false claim", () => {
    const stdout = swarmStdout("npm test", false);
    const { record: one } = record(
      digestOf("m"),
      {
        invocations: [
          {
            ...record(digestOf("m")).record.invocations[0],
            exitCode: 1,
            claimedSuccess: false,
            stdoutDigest: digestOf(stdout),
          },
        ],
      },
      stdout,
    );
    const row = analyzeRecord(one, { blob: () => stdout, task: tasks[0] });
    expect(row.correctPatch).toBe(true);
    expect(row.claim).toBe("reports-not-acceptable");
    expect(row.falseClaim).toBe(false);
    expect(row.delivered).toBe(false);
  });

  it("reads a wall kill as not finishing normally and as time, not a claim", () => {
    const { record: one } = record(digestOf("m"), {
      invocations: [
        {
          ...record(digestOf("m")).record.invocations[0],
          exitCode: null,
          signal: "SIGKILL(deadline)",
        },
      ],
      hidden: { verdict: "fail", basis: "hidden tests exited 1", detailDigest: digestOf("") },
    });
    const row = analyzeRecord(one, { blob: () => "" });
    expect(row.claim).toBe("killed");
    expect(row.delivered).toBe(false);
    expect(row.notDeliveredBecause).toContain("killed at the wall (SIGKILL(deadline))");
  });

  it("splits the launch's time into agent, preparation and scoring without overlap", () => {
    const row = analyzeRecord(record(digestOf("m")).record);
    expect(row.time.elapsedMs).toBe(600_000);
    expect(row.time.agentMs + row.time.preparationMs + row.time.scoringAndHarnessMs).toBe(600_000);
  });

  it("marks an OpenCode run with no answer as no-answer, not a claim", () => {
    const row = analyzeRecord(record(digestOf("m"), { arm: "opencode" }).record, {
      blob: () => "",
    });
    expect(row.claim).toBe("no-answer");
    expect(row.falseClaim).toBe(false);
  });
});

describe("eligibility for a controlled comparison", () => {
  it("folds the spellings of one npm script and nothing else", () => {
    expect(normalizeCommand("npm run --loglevel=error test")).toBe("npm run test");
    expect(normalizeCommand("npm test")).toBe("npm run test");
    expect(normalizeCommand("npm run test-node")).toBe("npm run test-node");
    expect(normalizeCommand("npx tap")).toBe("npx tap");
  });

  it("makes a Swarm launch ineligible when the product's planned tests gate is not the task's, delivery notwithstanding", () => {
    // The present configuration gap: the task says `npm run test-node`, the product planned
    // the manifest's `test` script. The patch is correct and the run delivered; the launch is
    // still no controlled comparison.
    const stdout = swarmStdout("npm run --loglevel=error test");
    const { record: one } = record(digestOf("m"), { task: "repo-feature-thing" }, stdout);
    const row = analyzeRecord(one, {
      blob: () => stdout,
      task: tasks[1],
      scripts: { test: "npm run test-node && npm run test-chrome" },
    });
    expect(row.delivered).toBe(true);
    expect(row.eligible).toBe(false);
    expect(row.ineligibleBecause[0]).toContain('"npm run --loglevel=error test"');
    expect(row.ineligibleBecause[0]).toContain("script body");
    expect(row.ineligibleBecause[0]).toContain('"npm run test-node"');
    expect(row.setup.gateMismatch).toBe(true);
  });

  it("keeps a Swarm launch eligible when the gate matches the task under another spelling", () => {
    const stdout = swarmStdout("npm run --loglevel=error test");
    const { record: one } = record(digestOf("m"), {}, stdout);
    const row = analyzeRecord(one, { blob: () => stdout, task: tasks[0] });
    expect(row.eligible).toBe(true);
    expect(row.setup.gateMismatch).toBe(false);
  });

  it("marks an arm that installed a prerequisite inside the task, and a later launch whose gate used it", () => {
    const installing = swarmStdout(
      "npm run --loglevel=error test",
      false,
      "tool shell <- npx playwright install chromium\nChromium Headless Shell downloaded to /tmp/swarm-child-home/Library/Caches/ms-playwright/x",
    );
    const first = analyzeRecord(record(digestOf("m"), {}, installing).record, {
      blob: () => installing,
      task: tasks[0],
    });
    expect(first.eligible).toBe(false);
    expect(first.setup.installedPrerequisite).toBe(true);
    expect(first.ineligibleBecause.join(" ")).toContain("installed a prerequisite");

    const later = swarmStdout("npm run --loglevel=error test");
    const dependent = analyzeRecord(record(digestOf("m"), {}, later).record, {
      blob: () => later,
      task: tasks[0],
      earlierSwarmInstalls: true,
      testsGateRan:
        "npm run --loglevel=error test\n> test-chrome\nChromium 141 ... 510 tests passed",
    });
    expect(dependent.eligible).toBe(false);
    expect(dependent.setup.dependedOnSharedPrerequisite).toBe(true);
    expect(dependent.ineligibleBecause.join(" ")).toContain("shared child HOME");

    const independent = analyzeRecord(record(digestOf("m"), {}, later).record, {
      blob: () => later,
      task: tasks[0],
      earlierSwarmInstalls: true,
      testsGateRan: "npm run --loglevel=error test\nmocha 1249 passing",
    });
    expect(independent.eligible).toBe(true);
    expect(independent.setup.dependedOnSharedPrerequisite).toBe(false);

    // With no gate output packaged, whether it depended on the shared state is unknown, which
    // is not eligibility.
    const unknown = analyzeRecord(record(digestOf("m"), {}, later).record, {
      blob: () => later,
      task: tasks[0],
      earlierSwarmInstalls: true,
      testsGateRan: null,
    });
    expect(unknown.eligible).toBe(false);
    expect(unknown.setup.dependedOnSharedPrerequisite).toBeNull();
  });

  it("reads a record with its own prepared state as not sharing a home", () => {
    const stdout = swarmStdout("npm run --loglevel=error test");
    const { record: one } = record(
      digestOf("m"),
      {
        preparedState: {
          home: "/x",
          fresh: true,
          npmCache: "shared",
          browserCacheBefore: false,
          browserCacheAfter: false,
        },
        gatePlan: {
          ok: true,
          expected: "npm test",
          effective: "npm test",
          status: "passed",
          bundleDirectory: null,
          detail: "",
        },
      },
      stdout,
    );
    const row = analyzeRecord(one, {
      blob: () => stdout,
      task: tasks[0],
      earlierSwarmInstalls: true,
    });
    expect(row.setup.sharedHome).toBe(false);
    expect(row.eligible).toBe(true);
  });
});

describe("the evidence directory as the only source", () => {
  it("derives a complete stage from the manifest, the records and the verified blobs alone", () => {
    const { root, digest } = evidence({
      launches: fourLaunches,
      records: [
        (d) => record(d),
        (d) => record(d, { arm: "opencode", order: 1 }, opencodeStdout()),
        (d) =>
          record(d, { task: "repo-feature-thing", order: 2 }, swarmStdout("npm run test-node")),
        (d) =>
          record(d, { task: "repo-feature-thing", arm: "opencode", order: 3 }, opencodeStdout()),
      ],
    });
    const stage = readStage(root);
    expect(stage.digest).toBe(digest);
    expect(stage.validity).toEqual({ complete: true, problems: [], cells: 4 });
    expect(stage.rows).toHaveLength(4);
    expect(stage.rows.every((row) => row.delivered && row.eligible)).toBe(true);
    expect(analysisOf(stage, null).result).toBe("derived");
  });

  it("is incomplete with every problem named when the blobs are absent", () => {
    const { root } = evidence({
      launches: fourLaunches.slice(0, 1),
      records: [(d) => record(d)],
      blobs: false,
    });
    const stage = readStage(root);
    expect(stage.validity.complete).toBe(false);
    expect(
      stage.validity.problems.some((one) => /cites sha256:[0-9a-f]+, which is missing/.test(one)),
    ).toBe(true);
    expect(analysisOf(stage, null).result).toBe("incomplete");
    expect(analysisOf(stage, null).stageA.gate).toBeNull();
  });

  it("is incomplete when a blob does not match the digest it is filed under", () => {
    const stdout = swarmStdout("npm test");
    const { root } = evidence({
      launches: fourLaunches.slice(0, 1),
      records: [(d) => record(d, {}, stdout)],
      corrupt: [digestOf(stdout)],
    });
    const stage = readStage(root);
    expect(stage.validity.complete).toBe(false);
    expect(stage.validity.problems.join("\n")).toContain("which is corrupt");
    // Nothing is read from a corrupt blob: the claim is unreadable, not whatever the bytes say.
    expect(stage.rows[0].claim).toBe("unreadable");
  });

  it("is incomplete when a frozen cell has no record or a cell is recorded twice", () => {
    const missing = evidence({ launches: fourLaunches, records: [(d) => record(d)] });
    const problems = readStage(missing.root).validity.problems;
    expect(problems).toContain("the frozen cell repo-bugfix-thing opencode has no record");
    expect(problems).toContain("the frozen cell repo-feature-thing swarm has no record");

    const duplicated = evidence({
      launches: fourLaunches.slice(0, 1),
      records: [(d) => record(d)],
      extraFiles: {},
    });
    // A second record of the same cell under another launch-record name.
    const { record: twin } = record(duplicated.digest);
    writeFileSync(
      join(duplicated.root, "records", "repo-bugfix-thing.swarm.json"),
      JSON.stringify(twin),
    );
    const { record: stray } = record(duplicated.digest, { task: "repo-bugfix-thing", order: 7 });
    writeFileSync(
      join(duplicated.root, "records", "repo-bugfix-thing.swarm.json"),
      JSON.stringify(twin),
    );
    mkdirSync(join(duplicated.root, "records", "x"), { recursive: true });
    const stage = readStage(duplicated.root);
    expect(stage.validity.cells).toBe(1);
    // The same cell written under a halted-attempt name is not a second record of it; a second
    // launch record of the cell is.
    const other = evidence({
      launches: fourLaunches.slice(0, 1),
      records: [(d) => record(d)],
    });
    const { record: again } = record(other.digest, { arm: "swarm", task: "repo-bugfix-thing" });
    writeFileSync(
      join(other.root, "records", "repo-bugfix-thing.swarm.json"),
      JSON.stringify(again),
    );
    writeFileSync(
      join(other.root, "records", "repo-bugfix-thing-again.swarm.json"),
      JSON.stringify({ ...stray, task: "repo-bugfix-thing" }),
    );
    const twice = readStage(other.root);
    expect(twice.validity.problems.join("\n")).toContain(
      "duplicates the cell repo-bugfix-thing swarm",
    );
  });

  it("is incomplete when a record names another manifest or overruns the launch deadline", () => {
    const { root } = evidence({
      launches: fourLaunches.slice(0, 1),
      records: [
        (d) =>
          record(digestOf("another manifest"), {
            invocations: [
              { ...record(d).record.invocations[0], wallMs: 19 * 60_000 + 60_000 + 10_001 },
            ],
            totals: {
              agentWallMs: 19 * 60_000 + 60_000 + 10_001,
              tokens: 1000,
              tokensUnknownInvocations: 0,
            },
          }),
      ],
    });
    const problems = readStage(root).validity.problems.join("\n");
    expect(problems).toContain("names manifest");
    expect(problems).toContain("over the 1140000 ms deadline");
  });

  it("allows the kill to land within the termination bound after the deadline and grace", () => {
    const { root } = evidence({
      launches: fourLaunches.slice(0, 1),
      records: [
        (d) =>
          record(d, {
            invocations: [
              {
                ...record(d).record.invocations[0],
                wallMs: 19 * 60_000 + 60_000 + 39,
                exitCode: null,
                signal: "SIGKILL(deadline)",
              },
            ],
            totals: {
              agentWallMs: 19 * 60_000 + 60_000 + 39,
              tokens: 1000,
              tokensUnknownInvocations: 0,
            },
          }),
      ],
    });
    expect(readStage(root).validity.complete).toBe(true);
  });
});

describe("armSummary and the gates", () => {
  it("leaves cost per delivery undefined at zero deliveries", () => {
    const summary = armSummary([analyzeRecord(record(digestOf("m")).record)]);
    expect(summary.deliveries).toBe(0);
    expect(summary.correctPatches).toBe(1);
    expect(summary.costPerDelivery.agentMinutes).toBe("undefined (zero deliveries)");
  });

  it("fails stage A's first item on a setup problem even with eight valid records", () => {
    const stdout = swarmStdout("npm run --loglevel=error test");
    const rows = [];
    for (let index = 0; index < 8; index += 1)
      rows.push(
        analyzeRecord(
          record(
            digestOf("m"),
            {
              task: index % 2 ? "repo-feature-thing" : "repo-bugfix-thing",
              arm: index < 4 ? "swarm" : "opencode",
              order: index,
            },
            stdout,
          ).record,
          {
            blob: () => (index < 4 ? stdout : opencodeStdout()),
            task: index % 2 ? tasks[1] : tasks[0],
          },
        ),
      );
    const gate = stageAGate(rows, tasks);
    expect(gate.items[0].holds).toBe(false);
    expect(gate.items[0].value).toContain("setup problems on repo-feature-thing swarm");
    expect(gate.qualifies).toBe(false);
  });

  it("does not qualify stage A when fewer than eight launches are valid", () => {
    const gate = stageAGate([analyzeRecord(record(digestOf("m")).record)], tasks);
    expect(gate.qualifies).toBe(false);
    expect(gate.items[0].holds).toBe(false);
  });

  it("does not let stage B proceed on Swarm records alone, with no OpenCode cells to compare", () => {
    const stdout = swarmStdout("npm run --loglevel=error test");
    const swarmOnly = [
      analyzeRecord(record(digestOf("m"), { task: "repo-bugfix-thing" }, stdout).record, {
        blob: () => stdout,
        task: tasks[0],
      }),
      analyzeRecord(
        record(digestOf("m"), { task: "repo-feature-thing" }, swarmStdout("npm run test-node"))
          .record,
        {
          blob: () => swarmStdout("npm run test-node"),
          task: tasks[1],
        },
      ),
    ];
    const gate = stageBGate(swarmOnly, swarmOnly);
    expect(gate.items[0].holds).toBe(false);
    expect(gate.items[0].value).toContain("opencode 0");
    expect(gate.proceeds).toBe(false);
  });

  it("needs a delivery on both sides before the time route can hold, and compares corrections on it", () => {
    const stdout = swarmStdout("npm run --loglevel=error test");
    const rows = [
      analyzeRecord(record(digestOf("m"), { corrections: 1 }, stdout).record, {
        blob: () => stdout,
        task: tasks[0],
      }),
      analyzeRecord(
        record(
          digestOf("m"),
          { arm: "opencode", order: 1, endedAt: "2026-10-15T01:30:00.000Z" },
          opencodeStdout(),
        ).record,
        {
          blob: () => opencodeStdout(),
          task: tasks[0],
        },
      ),
    ];
    const gate = stageBGate(rows, rows);
    // One delivery each; Swarm used less time but a scripted correction where OpenCode used none.
    expect(gate.items[3].holds).toBe(false);
    expect(gate.items[3].value).toContain(
      "corrections no worse on the 1 task(s) both deliver: false",
    );
  });
});
