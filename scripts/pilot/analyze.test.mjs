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
  ruleFor,
  stageAGate,
  stageAGate2026_10_15,
  stageBGate,
  usageOf,
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

describe("the 2026-10-15 rule", () => {
  const row = (arm, task, over = {}) => ({
    task,
    arm,
    order: 0,
    valid: true,
    eligible: true,
    correctPatch: true,
    delivered: true,
    deliveredWithoutCorrection: true,
    falseClaim: false,
    claim: "claims-completion",
    corrections: 0,
    invocations: [{ signal: null }],
    time: { agentMs: 60_000, preparationMs: 0, scoringAndHarnessMs: 0, elapsedMs: 60_000 },
    tokens: { total: 1000, unknownInvocations: 0, usage: null },
    ...over,
  });
  const tasks = [
    { id: "b", workType: "bugfix" },
    { id: "f", workType: "feature" },
    { id: "r", workType: "refactor" },
    { id: "u", workType: "upgrade" },
  ];
  const stageA = (swarmOver, opencodeOver) => [
    ...tasks.map((t) => row("swarm", t.id, swarmOver(t.id))),
    ...tasks.map((t) => row("opencode", t.id, opencodeOver(t.id))),
  ];

  it("is selected by the manifest's purpose and ties are ties", () => {
    expect(ruleFor({ purpose: "comparison 2026-10-15, stage A: four fresh tasks" })).toBe(
      "2026-10-15",
    );
    expect(ruleFor({ purpose: "real-task pilot 2026-10-14, stage A" })).toBe("pilot-2026-10-14");
    const rows = stageA(
      () => ({}),
      () => ({}),
    );
    const gate = stageAGate2026_10_15(rows, tasks);
    expect(gate.items[0].holds).toBe(true);
    expect(gate.items[1].holds).toBe(true);
    // Equal deliveries, equal corrections: no advantage, and no loss either.
    expect(gate.items[2].holds).toBe(false);
    expect(gate.items[3].holds).toBe(true);
    expect(gate.qualifies).toBe(false);
    expect(gate.primary.measures.every((one) => one.verdict === "tie")).toBe(true);
  });

  it("passes on more deliveries without correction and fails on a cost regression named rather than hidden", () => {
    const rows = stageA(
      () => ({}),
      (id) =>
        id === "r"
          ? {
              delivered: false,
              deliveredWithoutCorrection: false,
              correctPatch: false,
              corrections: 2,
            }
          : {
              time: {
                agentMs: 30_000,
                preparationMs: 0,
                scoringAndHarnessMs: 0,
                elapsedMs: 30_000,
              },
            },
    );
    const gate = stageAGate2026_10_15(rows, tasks);
    expect(gate.items[2].holds).toBe(true);
    expect(gate.primary.advantageBasis).toBe("more correct deliveries without correction");
    // OpenCode's three deliveries cost 1.5 minutes together; Swarm's four cost 4: a regression
    // on end-to-end minutes per delivery, which the item names and the gate does not hide.
    expect(gate.primary.costRegression).toBe(true);
    expect(gate.items[3].value).toContain("cost regression: yes");
    expect(gate.qualifies).toBe(true);
  });

  it("fails item 4 where Swarm loses a primary quality measure, and item 2 on a false claim", () => {
    const rows = stageA(
      (id) => (id === "u" ? { falseClaim: true, delivered: false, correctPatch: false } : {}),
      () => ({}),
    );
    const gate = stageAGate2026_10_15(rows, tasks);
    expect(gate.items[1].holds).toBe(false);
    expect(gate.items[3].holds).toBe(false);
    expect(
      gate.primary.measures.find((one) => one.measure === "false completion claims").verdict,
    ).toBe("loss");
  });

  it("sums usage by kind and keeps a kind nobody reported null", () => {
    expect(
      usageOf([
        { usage: { input: 10, output: 2, reasoning: null, cacheRead: 3, cacheWrite: null } },
        { usage: null },
        { usage: { input: 5, output: 1, reasoning: 4, cacheRead: null, cacheWrite: null } },
      ]),
    ).toEqual({
      input: 15,
      output: 3,
      reasoning: 4,
      cacheRead: 3,
      cacheWrite: null,
      unknownCalls: null,
    });
    expect(usageOf([{ usage: null }])).toBeNull();
    // Calls answered without usage are summed apart, so a reader sees the totals are lower bounds.
    const kinds = { input: 1, output: 1, reasoning: null, cacheRead: null, cacheWrite: null };
    expect(
      usageOf([{ usage: { ...kinds, unknownCalls: 0 } }, { usage: { ...kinds, unknownCalls: 2 } }])
        .unknownCalls,
    ).toBe(2);
  });

  it("decides a false claim by the dated review of the final report where one was made, keeping the heuristic beside it", () => {
    const failed = { verdict: "fail", basis: "hidden tests exited 1", detailDigest: digestOf("") };
    const opencode = (d, text) =>
      record(d, { arm: "opencode", hidden: failed }, opencodeStdout(text));
    const analyze = (built, entry) =>
      analyzeRecord(built.record, {
        blob: (cited) => built.blobs[cited] ?? null,
        claimReview:
          entry === undefined
            ? undefined
            : { "repo-bugfix-thing.opencode": { rule: "final-report-claim-v1", ...entry } },
      });
    const d = digestOf("manifest");
    // The heuristic reads "the visible tests pass" as a completion claim; the review does not.
    const narrow = opencode(d, "I ran the visible check and it passes.");
    expect(analyze(narrow).falseClaim).toBe(true);
    const reviewed = analyze(narrow, {
      class: "no-completion-claim",
      quote: "I ran the visible check and it passes.",
      reason: "reports one observation and does not say the task is done",
    });
    expect(reviewed.falseClaim).toBe(false);
    expect(reviewed.claimReviewed).toBe(true);
    expect(reviewed.heuristicClaim.claim).toBe("claims-completion");
    // An unjudged report is neither a false claim nor a delivery.
    const passed = record(d, { arm: "opencode" }, opencodeStdout("Done, mostly."));
    const unjudged = analyzeRecord(passed.record, {
      blob: (cited) => passed.blobs[cited] ?? null,
      claimReview: {
        "repo-bugfix-thing.opencode": {
          rule: "final-report-claim-v1",
          class: "unjudged",
          quote: "Done, mostly.",
          reason: "mixed",
        },
      },
    });
    expect(unjudged.falseClaim).toBe(false);
    expect(unjudged.delivered).toBe(false);
    expect(armSummary([unjudged]).uncertainClaims).toBe(1);
  });

  it("bounds a record that measured its cleanup by the deadline itself, the grace not being solving time", () => {
    const killed = (wallMs) => (d) =>
      record(d, {
        invocations: [
          {
            ...record(d).record.invocations[0],
            wallMs,
            exitCode: null,
            signal: "SIGKILL(deadline)",
          },
        ],
        totals: { agentWallMs: wallMs, tokens: 1000, tokensUnknownInvocations: 0 },
        cleanup: { limitMs: 60_000, deadlineKills: 1, wallMs: 40, strays: [] },
      });
    const within = evidence({
      launches: fourLaunches.slice(0, 1),
      records: [killed(19 * 60_000 + 40)],
    });
    expect(readStage(within.root).validity.complete).toBe(true);
    const intoGrace = evidence({
      launches: fourLaunches.slice(0, 1),
      records: [killed(19 * 60_000 + 30_000)],
    });
    expect(readStage(intoGrace.root).validity.problems.join("\n")).toContain(
      "over the 1140000 ms deadline",
    );
  });
});
