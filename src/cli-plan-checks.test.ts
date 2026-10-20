import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeCriteria, type PlanChecksDependencies, planChecks } from "./cli-plan-checks.ts";
import { admitPlannedChecks } from "./cli-planned-checks.ts";
import { createFixedRandom } from "./core/test-doubles.ts";
import { readSessionEvidence } from "./durable/session-evidence.ts";
import { asJsonValue } from "./evidence/canonical-json.ts";
import { freezeGoalContract, type GoalContract } from "./evidence/goal-contract.ts";
import { createRecordingModelClient } from "./evidence/model-call-recording.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import {
  createFixtureModelClient,
  type FixtureTurn,
  respondWithText,
  respondWithToolCalls,
} from "./providers/fixture-provider.ts";
import { plannedCheckProbe } from "./workers/planned-check-program.ts";

const execute = promisify(execFile);
const clock = { now: () => Date.now(), sleep: () => Promise.resolve() };

let root = "";
let workspace = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-plan-checks-"));
  workspace = join(root, "repo");
  await execute("mkdir", ["-p", workspace]);
  await writeFile(
    join(workspace, "package.json"),
    '{"name":"slug","private":true,"type":"module","scripts":{"test":"node --test"}}\n',
  );
  await writeFile(join(workspace, "slug.mjs"), "export const slugify = (s) => s;\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const task = "slugify collapses whitespace to one dash";

const contractCall = (goal: string): FixtureTurn =>
  respondWithToolCalls("pinning", [
    {
      callId: "pin",
      toolName: "declare_goal_contract",
      input: {
        version: 1,
        goal,
        requirements: [
          {
            id: "collapse",
            description: "runs of whitespace become one dash",
            checks: ["collapse"],
          },
        ],
        checks: [
          {
            id: "collapse",
            command: "node --test acceptance/collapse.test.mjs",
            author: "user",
            exposure: "withheld",
            artifacts: [
              { path: "acceptance/collapse.test.mjs", content: "import test from 'node:test';\n" },
            ],
          },
        ],
        immutablePaths: [],
      },
    },
  ]);

function deps(turns: readonly FixtureTurn[], extra: Partial<PlanChecksDependencies> = {}) {
  const notes: string[] = [];
  // One scripted model across rounds, as a provider client is: a second planning round
  // continues the script rather than replaying it.
  const model = createFixtureModelClient({ modelId: "fixture:plan", turns });
  const planner: PlanChecksDependencies = {
    task,
    workspace,
    home: root,
    sessionRoot: join(root, "sessions"),
    runId: "run-1",
    createModel: (planning) => createRecordingModelClient(model, planning),
    clock,
    random: createFixedRandom(),
    maxSteps: 6,
    maxTokens: 50_000,
    maxWallMs: 60_000,
    signal: new AbortController().signal,
    note: (line) => notes.push(line),
    ...extra,
  };
  return { planner, notes };
}

describe("planning the completion criteria", () => {
  it("seals model-authored criteria noninteractively, labelled, on a planning chain of their own", async () => {
    const { planner, notes } = deps([
      respondWithToolCalls("reading", [
        { callId: "r", toolName: "read", input: { path: "slug.mjs" } },
      ]),
      contractCall(task),
      respondWithText("planned"),
    ]);
    const outcome = await planChecks(planner);
    expect(outcome.kind).toBe("sealed");
    if (outcome.kind !== "sealed") throw new Error("unreachable");
    expect(outcome.confirmedBy).toBe("noninteractive");
    // Whatever the model wrote, the harness labels the checks as its and shared.
    expect(outcome.contract.checks[0]).toMatchObject({ author: "model", exposure: "shared" });
    expect(outcome.steps).toBe(3);
    expect(outcome.planningSessionId).toBe("run-1-plan");
    const planning = await readSessionEvidence(join(root, "sessions"), "run-1-plan");
    expect(planning.records.filter((record) => record.type === "model-call")).toHaveLength(3);
    expect(notes.join("\n")).toContain("completion criteria (sealed before implementation)");
    expect(notes.join("\n")).toContain(
      "check collapse: node --test acceptance/collapse.test.mjs [model-authored]",
    );
  });

  it("asks a person on a terminal and treats anything but y as a decline", async () => {
    const asked: string[] = [];
    const { planner } = deps([contractCall(task), respondWithText("planned")], {
      ask: async (question) => {
        asked.push(question);
        return "n";
      },
    });
    const outcome = await planChecks(planner);
    expect(outcome.kind).toBe("declined");
    expect(asked[0]).toContain("Seal these criteria");
  });

  it("reports an unresolved task when the planner pins nothing, and never guesses noninteractively", async () => {
    const { planner } = deps([respondWithText("Which of the two slugify functions do you mean?")]);
    const outcome = await planChecks(planner);
    expect(outcome.kind).toBe("unresolved");
    if (outcome.kind !== "unresolved") throw new Error("unreachable");
    expect(outcome.stopReason).toBe("completed");
    expect(outcome.account).toBe("Which of the two slugify functions do you mean?");
  });

  it("gives a person one clarification round and plans again with the task kept verbatim", async () => {
    const answers = ["the one in slug.mjs", "y"];
    const clarified = `${task}\n\nClarification from the user: the one in slug.mjs`;
    const { planner } = deps(
      [
        respondWithText("Which of the two slugify functions do you mean?"),
        contractCall(clarified),
        respondWithText("planned"),
      ],
      { ask: async () => answers.shift() ?? "" },
    );
    const outcome = await planChecks(planner);
    expect(outcome.kind).toBe("sealed");
    if (outcome.kind !== "sealed") throw new Error("unreachable");
    expect(outcome.contract.goal).toBe(clarified);
    expect(outcome.confirmedBy).toBe("person");
  });

  it("stops after the one round when the person has no answer", async () => {
    const { planner } = deps([respondWithText("Which one?")], { ask: async () => "" });
    const outcome = await planChecks(planner);
    expect(outcome.kind).toBe("unresolved");
  });
});

it("describes criteria with their author and the ones that stay unjudged", () => {
  const lines = describeCriteria({
    version: 1,
    goal: "g\nmore",
    requirements: [
      { id: "a", description: "does a", checks: ["ca"] },
      { id: "b", description: "does b", checks: [] },
    ],
    checks: [
      { id: "ca", command: "npm test\n", author: "model", exposure: "shared", artifacts: [] },
    ],
    immutablePaths: ["tests"],
    selection: "stable",
  });
  expect(lines).toContain("  goal: g");
  expect(lines).toContain("       check ca: npm test [model-authored]");
  expect(lines).toContain("       decided by no check: stays unjudged");
  expect(lines).toContain("  immutable: tests");
});

/** The coverage review of one requirement, with no relation. */
const review = (requirementId: string) => ({
  callId: `review-${requirementId}`,
  toolName: "declare_coverage_review",
  input: {
    id: `${requirementId}-review`,
    requirementId,
    change: "runs of whitespace become one dash",
    keeps: "single words",
    wrongImplementation: "replace each whitespace character with its own dash",
    distinguishedBy: [],
    noRelation: "covered by examples",
    untested: "tabs",
  },
});

describe("the planned-check revision and its share of the planning allowance", () => {
  const declaring = (ids: readonly string[], reviewed = true): FixtureTurn =>
    respondWithToolCalls("pinning", [
      ...ids.map((id) => ({
        callId: `declare-${id}`,
        toolName: "declare_planned_check",
        input: {
          id,
          purpose: "change",
          requirementId: `r-${id}`,
          requirement: `requirement ${id}`,
          quote: "collapses whitespace",
          program: "import { slugify } from './slug.mjs';\nexport default slugify;\n",
          cases: [{ input: "a  b", expected: "a-b", changed: true }],
          why: "the task says runs of whitespace become one dash",
        },
      })),
      ...(reviewed ? ids.map((id) => review(`r-${id}`)) : []),
    ]);

  /** Admission that takes `ms` of the planning clock, admits the checks named, and drops the rest. */
  function admitting(admit: readonly string[], ms: () => number, advance: (by: number) => void) {
    return (_chain: unknown, contract: GoalContract, base: GoalContract | undefined) => {
      advance(ms());
      const supplied = new Set((base?.checks ?? []).map((one) => one.id));
      const planned = contract.checks.filter((one) => !supplied.has(one.id));
      const kept = contract.checks.filter((one) => supplied.has(one.id) || admit.includes(one.id));
      // As admission does: a planned requirement keeps its admitted diagnostics, and stays when it
      // quotes the task even with none left.
      const requirements = contract.requirements.flatMap((one) => {
        if (one.planned === undefined) return [one];
        const diagnostics = one.planned.diagnostics.filter((id) => kept.some((k) => k.id === id));
        return diagnostics.length === 0 && one.planned.quote === undefined
          ? []
          : [{ ...one, planned: { ...one.planned, diagnostics } }];
      });
      return Promise.resolve({
        contract:
          requirements.length === 0
            ? null
            : freezeGoalContract({ ...contract, requirements, checks: kept }).contract,
        decisions: planned.map((one) => ({
          check: one.id,
          atBase: one.atBase ?? null,
          observed: admit.includes(one.id) ? ("rejected" as const) : ("accepted" as const),
          admitted: admit.includes(one.id),
          reason: admit.includes(one.id) ? "admitted" : "it passes on the base",
          broken: false,
          excerpt: null,
          record: null,
          basis: "model-asserted" as const,
          claimedChanges: null,
          finding: admit.includes(one.id) ? ("admitted" as const) : ("does-not-detect" as const),
          control: null,
          establishes: null,
          unknown: null,
          notes: [],
          disagreements: null,
          thrown: null,
          reclassified: false,
          probeRecord: null,
        })),
        droppedRequirements: [],
        unverifiedRequirements: requirements
          .filter((one) => one.planned?.diagnostics.length === 0)
          .map((one) => one.id),
      });
    };
  }

  function controlled(admissionMs: number) {
    let now = 0;
    return {
      clock: { now: () => now, sleep: () => Promise.resolve() },
      advance: (by: number) => {
        now += by;
      },
      admissionMs: () => admissionMs,
    };
  }

  it("withholds the revision on the record when its re-admission would not fit", async () => {
    const time = controlled(100_000);
    const { planner, notes } = deps([declaring(["a", "b"]), respondWithText("pinned")], {
      clock: time.clock,
      maxWallMs: 200_000,
      admit: admitting(["a"], time.admissionMs, time.advance),
    });
    const outcome = await planChecks(planner);
    expect(outcome.kind).toBe("sealed");
    expect(outcome.admission?.revision).toEqual({
      outcome: "withheld",
      remainingMs: 100_000,
      neededMs: 160_000,
    });
    // r-b quotes the task, so it stays sealed with no check rather than vanishing; nothing the
    // planner invented was dropped.
    expect(outcome.admission?.uncheckedRequirements).toEqual([]);
    if (outcome.kind !== "sealed") throw new Error("unreachable");
    expect(outcome.contract.requirements.find((one) => one.id === "r-b")).toMatchObject({
      checks: [],
      planned: { quote: "collapses whitespace", diagnostics: [] },
    });
    expect(notes.join("\n")).toContain("no revision of the dropped planned checks: 100s");
    const planning = await readSessionEvidence(join(root, "sessions"), "run-1-plan");
    const revision = planning.records
      .filter((record) => record.type === "verification-command")
      .map((record) => planning.payloads.get(record.payloadDigest) as { rule?: string })
      .find((payload) => payload.rule === "planned-check-revision-v2");
    expect(revision).toMatchObject({ outcome: "withheld", remainingMs: 100_000 });
  });

  /** The launch's planning, on an injected clock: the first round ends at `roundMs`. */
  function launchTimed(
    roundMs: number,
    admissionMs: number,
    extra: Partial<PlanChecksDependencies>,
  ) {
    let now = 0;
    let calls = 0;
    const scripted = createFixtureModelClient({
      modelId: "fixture:plan",
      turns: [declaring(["a", "b"]), respondWithText("pinned"), respondWithText("No replacement.")],
    });
    const timed = {
      modelId: scripted.modelId,
      generate: (request: Parameters<typeof scripted.generate>[0]) => {
        calls += 1;
        if (calls === 1) now += roundMs;
        return scripted.generate(request);
      },
    };
    return deps([], {
      clock: { now: () => now, sleep: () => Promise.resolve() },
      createModel: (chain) => createRecordingModelClient(timed as never, chain),
      admit: admitting(
        ["a"],
        () => admissionMs,
        (by) => {
          now += by;
        },
      ),
      ...extra,
    });
  }

  it("withholds the revision at the launch's 64 s left and 96 s needed when nothing may be borrowed", async () => {
    // The launch: a 336 s planning allowance, a first round ending at 235.3 s, admission 36.5 s.
    const { planner } = launchTimed(235_284, 36_489, { maxWallMs: 336_000 });
    const outcome = await planChecks(planner);
    expect(outcome.admission?.revision).toEqual({
      outcome: "withheld",
      remainingMs: 64_227,
      neededMs: 96_489,
    });
  });

  it("dispatches that revision by borrowing the 32 s shortfall from implementation, within the limit", async () => {
    const { planner, notes } = launchTimed(235_284, 36_489, {
      maxWallMs: 336_000,
      // A tenth of the launch's 14-minute total, as the command line sets it.
      revisionBorrowLimitMs: 84_000,
    });
    const outcome = await planChecks(planner);
    expect(outcome.admission?.revision).toMatchObject({ outcome: "ran", borrowedMs: 32_262 });
    expect(notes.join("\n")).toContain("the revision borrows 32s of implementation time");
    const planning = await readSessionEvidence(join(root, "sessions"), "run-1-plan");
    const revision = planning.records
      .filter((record) => record.type === "verification-command")
      .map((record) => planning.payloads.get(record.payloadDigest) as { rule?: string })
      .find((payload) => payload.rule === "planned-check-revision-v2");
    // The command time it rests on and the controller's arithmetic, apart.
    expect(revision).toMatchObject({
      outcome: "ran",
      remainingMs: 64_227,
      neededMs: 96_489,
      borrowedMs: 32_262,
      admissionMs: 36_489,
      minimumRevisionMs: 60_000,
      borrowLimitMs: 84_000,
    });
  });

  it("borrows a shortfall exactly at the limit and withholds one a millisecond over it", async () => {
    const atLimit = launchTimed(235_284, 36_489, {
      maxWallMs: 336_000,
      revisionBorrowLimitMs: 32_262,
    });
    expect((await planChecks(atLimit.planner)).admission?.revision).toMatchObject({
      outcome: "ran",
      borrowedMs: 32_262,
    });
    await rm(join(root, "sessions"), { recursive: true, force: true });
    const over = launchTimed(235_284, 36_489, {
      maxWallMs: 336_000,
      revisionBorrowLimitMs: 32_261,
    });
    expect((await planChecks(over.planner)).admission?.revision).toEqual({
      outcome: "withheld",
      remainingMs: 64_227,
      neededMs: 96_489,
      borrowLimitMs: 32_261,
    });
  });

  it("stops the first round after a base run that leaves less than admission and a revision need", async () => {
    let now = 0;
    const trial: FixtureTurn = respondWithToolCalls("trying", [
      { callId: "trial", toolName: "run_planned_checks_on_base", input: {} },
    ]);
    const { planner, notes } = deps(
      [declaring(["a"]), trial, respondWithText("one more look"), respondWithText("pinned")],
      {
        clock: { now: () => now, sleep: () => Promise.resolve() },
        maxWallMs: 300_000,
        // The base run takes 100 s: admission and a revision's re-admission need 200 s of it again,
        // with a minute for the revision, which is more than the quarter of the allowance left.
        admit: admitting(
          ["a"],
          () => 100_000,
          (by) => {
            now += by;
          },
        ),
      },
    );
    const outcome = await planChecks(planner);
    expect(outcome.kind).toBe("sealed");
    expect(notes.join("\n")).toContain(
      "the first planning round stopped after a base run at 100s: the last 260s are held for admission and a revision",
    );
    // Admission reuses that very run, so the round's checks cost no second base run.
    expect(notes.join("\n")).toContain("admission reuses the planner's own last base run");
    expect(now).toBe(100_000);
  });

  it("reports a task sentence quoted only by a requirement whose check was dropped as quoted, not checked", async () => {
    const time = controlled(100_000);
    const twoSentences = "slugify collapses whitespace to one dash. It keeps digits as they are.";
    const declaringBoth: FixtureTurn = respondWithToolCalls("pinning", [
      ...[
        ["a", "collapses whitespace"],
        ["b", "It keeps digits as they are"],
      ].map(([id, words]) => ({
        callId: `declare-${id}`,
        toolName: "declare_planned_check",
        input: {
          id,
          purpose: "change",
          requirementId: `r-${id}`,
          requirement: `requirement ${id}`,
          quote: words,
          program: "import { slugify } from './slug.mjs';\nexport default slugify;\n",
          cases: [{ input: "a  b", expected: "a-b", changed: true }],
          why: "the task says so",
        },
      })),
      review("r-a"),
      review("r-b"),
    ]);
    const { planner, notes } = deps([declaringBoth, respondWithText("pinned")], {
      task: twoSentences,
      clock: time.clock,
      maxWallMs: 200_000,
      admit: admitting(["a"], time.admissionMs, time.advance),
    });
    const outcome = await planChecks(planner);
    expect(outcome.admission?.coverage).toEqual({
      sentences: 2,
      quotedByAdmitted: [1],
      quotedWithoutCheck: [2],
    });
    expect(notes.join("\n")).toContain(
      "task sentences a planned requirement with an admitted check quotes: 1 of 2 (1); quoted only by a requirement with no admitted check: 2",
    );
  });

  it("revises within what is left after reserving its re-admission, keeping what was admitted", async () => {
    const time = controlled(20_000);
    const { planner } = deps(
      [
        declaring(["a", "b"]),
        respondWithText("pinned"),
        declaring(["c"]),
        respondWithText("replaced"),
      ],
      {
        clock: time.clock,
        maxWallMs: 200_000,
        admit: admitting(["a", "c"], time.admissionMs, time.advance),
      },
    );
    const outcome = await planChecks(planner);
    if (outcome.kind !== "sealed") throw new Error(`sealed, not ${outcome.kind}`);
    expect(outcome.contract.checks.map((one) => one.id)).toEqual(["a", "c"]);
    expect(outcome.admission).toMatchObject({
      admitted: ["a", "c"],
      unestablished: [],
      dropped: [{ check: "b", reason: "it passes on the base" }],
      uncheckedRequirements: [],
      revision: { outcome: "ran", admitted: ["c"] },
      coverage: { sentences: 1, quotedByAdmitted: [1], quotedWithoutCheck: [] },
      review: { round: "not-needed", unreviewed: [] },
    });
  });

  it("asks for the coverage review in a round of its own where the planner finished without it", async () => {
    const time = controlled(1_000);
    const { planner, notes } = deps(
      [
        declaring(["a"], false),
        respondWithText("pinned"),
        respondWithToolCalls("reviewing", [review("r-a")]),
        respondWithText("reviewed"),
      ],
      {
        clock: time.clock,
        maxWallMs: 600_000,
        admit: admitting(["a"], time.admissionMs, time.advance),
      },
    );
    const outcome = await planChecks(planner);
    if (outcome.kind !== "sealed") throw new Error(`sealed, not ${outcome.kind}`);
    expect(notes.join("\n")).toContain(
      "the planner finished with no coverage review of r-a; asking for one",
    );
    expect(outcome.admission?.review).toEqual({
      round: "ran",
      reviews: [
        {
          id: "r-a-review",
          requirement: "r-a",
          relation: null,
          noRelation: "covered by examples",
          distinguishedBy: [],
          rejectedChecks: [],
          untested: "tabs",
        },
      ],
      unreviewed: [],
    });
    // The checks the first round declared stand: the round continued its declaration.
    expect(outcome.contract.checks.map((one) => one.id)).toEqual(["a"]);
    const planning = await readSessionEvidence(join(root, "sessions"), "run-1-plan");
    const recorded = planning.records
      .filter((record) => record.type === "verification-command")
      .map(
        (record) =>
          planning.payloads.get(record.payloadDigest) as { rule?: string; limitation?: string },
      )
      .find((payload) => payload.rule === "planned-coverage-review-v1");
    expect(recorded).toMatchObject({ round: "ran", unreviewed: [] });
    expect(recorded?.limitation).toContain("are the planner's claims");
  });

  it("withholds the review round where too little planning remains, and seals with the gap named", async () => {
    const time = controlled(1_000);
    const { planner, notes } = deps([declaring(["a"], false), respondWithText("pinned")], {
      clock: time.clock,
      maxWallMs: 100_000,
      admit: admitting(["a"], time.admissionMs, time.advance),
    });
    const outcome = await planChecks(planner);
    expect(outcome.kind).toBe("sealed");
    expect(notes.join("\n")).toContain("no coverage review round: 100s of planning remain");
    expect(outcome.admission?.review).toEqual({
      round: "withheld",
      reviews: [],
      unreviewed: ["r-a"],
    });
  });
});

it("ends planning at its allowance even while a model call is still unanswered", async () => {
  // A stuck server: the call settles only when it is aborted. A planner whose allowance was
  // checked only between calls waited on one like this until the launch was killed.
  const unanswered = {
    modelId: "fixture:stuck",
    generate: (request: { abortSignal: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => {
        request.abortSignal.addEventListener("abort", () => reject(request.abortSignal.reason), {
          once: true,
        });
      }),
  };
  const { planner } = deps([], {
    maxWallMs: 300,
    createModel: () => unanswered as never,
    admit: () => Promise.reject(new Error("nothing was declared, so nothing is admitted")),
  });
  const started = Date.now();
  const outcome = await planChecks(planner);
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(outcome.kind).toBe("unresolved");
  // The run's own signal is not the planner's: implementation still has its allowance.
  expect(planner.signal.aborted).toBe(false);
});

/**
 * A requirement the task states as kept behaviour, for an input the task names, that the base does
 * not give: slugify is the identity on the base, and the task says "Hello World" must still read
 * "hello-world". The planner calls that check preserve, admission drops it, and from there the
 * requirement must stay in the work, through the revision, the coverage reading and the brief.
 * Admission is the real one; only the base run is simulated, from the identity the base computes.
 */
describe("a requirement whose only generated check is rejected", () => {
  const stillTask =
    'slugify turns spaces into dashes. A word without spaces must still come back as it is, and "Hello World" must still read "hello-world".';
  const keptQuote = '"Hello World" must still read "hello-world"';
  const program = "import { slugify } from './slug.mjs';\nexport default slugify;\n";
  const declare = (
    id: string,
    purpose: "change" | "preserve",
    requirementId: string,
    quote: string,
    cases: readonly { input: string; expected: string; changed?: boolean }[],
    why: string,
  ) => ({
    callId: `declare-${id}-${purpose}`,
    toolName: "declare_planned_check",
    input: {
      id,
      purpose,
      requirementId,
      requirement: `requirement ${requirementId}`,
      quote,
      program,
      cases,
      why,
    },
  });
  const reviewOf = (requirementId: string, distinguishedBy: readonly string[]) => ({
    callId: `review-${requirementId}`,
    toolName: "declare_coverage_review",
    input: {
      id: `${requirementId}-review`,
      requirementId,
      change: "spaces become dashes",
      keeps: "a word without spaces",
      wrongImplementation: "a dash for the first space only",
      distinguishedBy,
      noRelation: "covered by examples",
      untested: "tabs",
    },
  });
  const firstRound: FixtureTurn = respondWithToolCalls("pinning", [
    declare(
      "dashes",
      "change",
      "spaces",
      "slugify turns spaces into dashes",
      [
        { input: "a b", expected: "a-b", changed: true },
        { input: "plain", expected: "plain", changed: false },
      ],
      "the task says spaces become dashes",
    ),
    declare(
      "kept-forms",
      "preserve",
      "kept",
      keptQuote,
      [
        { input: "plain", expected: "plain" },
        { input: "Hello World", expected: "hello-world" },
      ],
      "the task says these still hold",
    ),
    reviewOf("spaces", ["dashes", "kept-forms"]),
    reviewOf("kept", ["kept-forms"]),
  ]);
  const reclassifying: FixtureTurn = respondWithToolCalls("reclassifying", [
    declare(
      "kept-forms",
      "change",
      "kept",
      keptQuote,
      [
        { input: "Hello World", expected: "hello-world", changed: true },
        { input: "plain", expected: "plain", changed: false },
      ],
      'the task names "Hello World" and says it must read "hello-world"; the base returns it unchanged, so the task asks for this outcome',
    ),
  ]);

  /** The base run admission makes, simulated from the identity the base computes. */
  async function simulatedBase(chain: EvidenceRecorder, contract: GoalContract) {
    for (const one of contract.checks) {
      if (one.behavior?.kind !== "cli") continue;
      const { inputs } = JSON.parse(one.behavior.stdin) as { inputs: unknown[] };
      const probing = one.behavior.argv[3] === plannedCheckProbe;
      const stdout = probing
        ? `${JSON.stringify({ calls: inputs.length, misread: [] })}\n`
        : inputs.map((value) => `${JSON.stringify({ input: value, result: value })}\n`).join("");
      await chain.record({
        type: "goal-check",
        actor: "harness",
        provenance: ["tool-output"],
        payload: asJsonValue({
          phase: "completed",
          checkId: one.id,
          status: probing || stdout === one.behavior.stdout[0]?.value ? "accepted" : "rejected",
          behavior: { exitCode: 0 },
          observation: {
            exitCode: 0,
            unavailable: null,
            outputTruncated: false,
            stdout,
            stderr: "",
          },
        }),
      });
    }
  }

  const realAdmission: NonNullable<PlanChecksDependencies["admit"]> = (
    chain,
    contract,
    base,
    options,
  ) =>
    admitPlannedChecks({
      task: stillTask,
      contract,
      base,
      evidence: chain,
      verifyAtBase: (probe) => simulatedBase(chain, probe),
      ...(options?.reclassified === undefined ? {} : { reclassified: options.reclassified }),
      ...(options?.contested === undefined ? {} : { contested: options.contested }),
    });

  function planning(turns: readonly FixtureTurn[], extra: Partial<PlanChecksDependencies> = {}) {
    const model = createFixtureModelClient({ modelId: "fixture:plan", turns });
    const made = deps([], {
      task: stillTask,
      maxWallMs: 600_000,
      createModel: (chain) => createRecordingModelClient(model, chain),
      admit: realAdmission,
      ...extra,
    });
    return { ...made, model };
  }

  const chainRule = async (rule: string) => {
    const chain = await readSessionEvidence(join(root, "sessions"), "run-1-plan");
    return chain.records
      .filter((record) => record.type === "verification-command")
      .map((record) => chain.payloads.get(record.payloadDigest) as Record<string, unknown>)
      .filter((payload) => payload.rule === rule);
  };

  it("hands the revision the task's words, each case with the base's answer, and the choice between correcting and reclassifying", async () => {
    const { planner, model } = planning([
      firstRound,
      respondWithText("pinned"),
      reclassifying,
      respondWithText("revised"),
    ]);
    const outcome = await planChecks(planner);
    const revisionBrief =
      model.requests
        .flatMap((request) => request.messages)
        .flatMap((message) => (message.role === "user" ? [message.text] : []))
        .find((text) => text.includes("were each run once on a fresh checkout")) ?? "";
    expect(revisionBrief).toContain(`quoting the task: ${JSON.stringify(keptQuote)}`);
    expect(revisionBrief).toContain(
      'case 2: input "Hello World", expected "hello-world"; the base gave "Hello World"; the task names this input',
    );
    expect(revisionBrief).toContain('case 1: input "plain", expected "plain"; the base agrees');
    expect(revisionBrief).toContain("correct the expectation");
    expect(revisionBrief).toContain("declare it again as a change check under the same id");
    // A revision continues work already read: it is told not to start over.
    expect(revisionBrief).toContain("Do not read the repository again");
    expect(outcome.kind).toBe("sealed");
    expect(outcome.admission?.revision).toEqual({
      outcome: "ran",
      admitted: ["kept-forms"],
      stopReason: "completed",
      reclassified: [
        {
          check: "kept-forms",
          requirement: "kept",
          from: "preserve",
          to: "change",
          justification: expect.stringContaining('the task names "Hello World"'),
        },
      ],
    });
    expect(outcome.admission?.uncovered).toEqual([]);
    const [revision] = await chainRule("planned-check-revision-v2");
    expect(revision).toMatchObject({ outcome: "ran", reclassified: [{ check: "kept-forms" }] });
  });

  it("keeps a requirement whose revision declares nothing visible as uncovered, with the reason and the next action", async () => {
    const { planner, notes } = planning([
      firstRound,
      respondWithText("pinned"),
      respondWithText("No replacement."),
    ]);
    const outcome = await planChecks(planner);
    if (outcome.kind !== "sealed") throw new Error(`sealed, not ${outcome.kind}`);
    expect(outcome.admission?.uncovered).toEqual([
      {
        id: "kept",
        quote: keptQuote,
        rejected: [
          { check: "kept-forms", reason: expect.stringContaining("disagreement with the base") },
        ],
        reason: expect.stringContaining(
          'the base gave "Hello World" for "Hello World", an input the task names',
        ),
        nextAction: expect.stringContaining("implement it from the task's words"),
      },
    ]);
    expect(outcome.admission?.uncovered[0]?.reason).toContain(
      "the revision declared no replacement",
    );
    // Nothing invented was dropped, so the list of unsealed requirements stays empty; the sealed
    // requirement with no check is reported apart rather than vanishing between the two.
    expect(outcome.admission?.uncheckedRequirements).toEqual([]);
    expect(notes.join("\n")).toContain("requirements no retained check covers: kept");
  });

  it("does not count a coverage review that names a rejected check as covering anything", async () => {
    const { planner } = planning([
      firstRound,
      respondWithText("pinned"),
      respondWithText("No replacement."),
    ]);
    const outcome = await planChecks(planner);
    const reviews = outcome.admission?.review.reviews ?? [];
    expect(reviews.find((one) => one.requirement === "spaces")).toMatchObject({
      distinguishedBy: ["dashes"],
      rejectedChecks: ["kept-forms"],
    });
    expect(reviews.find((one) => one.requirement === "kept")).toMatchObject({
      distinguishedBy: [],
      rejectedChecks: ["kept-forms"],
    });
    const [reconciled] = await chainRule("planned-coverage-reconciled-v3");
    expect(reconciled).toMatchObject({
      requirements: [
        { id: "spaces", retained: ["dashes"], rejected: [], covered: true },
        { id: "kept", retained: [], rejected: ["kept-forms"], covered: false },
      ],
    });
  });

  it("names a withheld revision in the uncovered requirement's reason", async () => {
    let now = 0;
    const { planner } = planning([firstRound, respondWithText("pinned")], {
      clock: { now: () => now, sleep: () => Promise.resolve() },
      maxWallMs: 200_000,
      admit: (chain, contract, base, options) => {
        now += 100_000;
        return realAdmission(chain, contract, base, options);
      },
    });
    const outcome = await planChecks(planner);
    expect(outcome.admission?.revision.outcome).toBe("withheld");
    expect(outcome.admission?.uncovered.map((one) => one.id)).toEqual(["kept"]);
    expect(outcome.admission?.uncovered[0]?.reason).toContain(
      "no revision ran: too little planning time remained",
    );
  });

  it("names a revision whose allowance ended before it declared anything", async () => {
    let now = 0;
    let calls = 0;
    const scripted = createFixtureModelClient({
      modelId: "fixture:plan",
      turns: [firstRound, respondWithText("pinned"), respondWithText("still reading")],
    });
    // The third call is the revision's first: it answers only after the revision's wall has gone.
    const slow = {
      modelId: scripted.modelId,
      generate: (request: Parameters<typeof scripted.generate>[0]) => {
        calls += 1;
        if (calls === 3) now += 1_000_000;
        return scripted.generate(request);
      },
    };
    const { planner } = planning([], {
      clock: { now: () => now, sleep: () => Promise.resolve() },
      createModel: (chain) => createRecordingModelClient(slow as never, chain),
    });
    const outcome = await planChecks(planner);
    expect(outcome.admission?.revision).toMatchObject({
      outcome: "ran",
      admitted: [],
      stopReason: "max-wall-time",
    });
    expect(outcome.admission?.uncovered[0]?.reason).toContain(
      "the revision's allowance ended before it declared a replacement",
    );
    expect(outcome.admission?.unresolvedOutcomes.map((one) => one.id)).toEqual(["kept#1"]);
    expect(outcome.admission?.unresolvedOutcomes[0]?.reason).toContain(
      "the revision's allowance ended before it declared a replacement",
    );
  });

  // One requirement, two requested outcomes: a word without spaces comes back as it is (checked,
  // and the base already does it), and "Hello World" reads "hello-world" (its only check refused).
  const wordQuote = "A word without spaces must still come back as it is";
  const siblings: FixtureTurn = respondWithToolCalls("pinning", [
    declare(
      "dashes",
      "change",
      "spaces",
      "slugify turns spaces into dashes",
      [
        { input: "a b", expected: "a-b", changed: true },
        { input: "plain", expected: "plain", changed: false },
      ],
      "the task says spaces become dashes",
    ),
    declare(
      "words-kept",
      "preserve",
      "kept",
      wordQuote,
      [
        { input: "plain", expected: "plain" },
        { input: "word", expected: "word" },
      ],
      "the task says a word comes back as it is",
    ),
    declare(
      "hello-kept",
      "preserve",
      "kept",
      keptQuote,
      [{ input: "Hello World", expected: "hello-world" }],
      "the task says this still holds",
    ),
    reviewOf("spaces", ["dashes"]),
    reviewOf("kept", ["words-kept", "hello-kept"]),
  ]);

  it("keeps an outcome unresolved when its check is refused and a sibling under the same requirement passes", async () => {
    const { planner, model, notes } = planning([
      siblings,
      respondWithText("pinned"),
      respondWithText("No replacement."),
    ]);
    const outcome = await planChecks(planner);
    if (outcome.kind !== "sealed") throw new Error(`sealed, not ${outcome.kind}`);
    // Per requirement, "kept" reads covered: words-kept is retained.
    expect(outcome.admission?.uncovered).toEqual([]);
    // Per outcome, the refused one stays in view, with what the base gave and what to do.
    expect(outcome.admission?.unresolvedOutcomes).toEqual([
      {
        id: "kept#2",
        requirement: "kept",
        quote: keptQuote,
        role: "keep",
        checks: [
          {
            check: "hello-kept",
            reason:
              'the base gave "Hello World" for "Hello World", an input the task names, where the check expected "hello-world"',
          },
        ],
        // The task's own input, with what was first expected and what the base gave there.
        taskInputs: [{ input: "Hello World", expected: '"hello-world"', base: '"Hello World"' }],
        reason: expect.stringContaining("the revision declared no replacement"),
        nextAction: expect.stringContaining('the task names "Hello World"'),
      },
    ]);
    // Recorded before admission filtered anything, and reconciled after it.
    const [declared] = await chainRule("planned-outcomes-v2");
    expect(declared).toMatchObject({
      round: "first",
      outcomes: [
        { id: "spaces#1", role: "change", declaredBy: ["dashes"] },
        { id: "spaces#2", role: "keep", declaredBy: ["dashes"] },
        { id: "kept#1", quote: wordQuote, role: "keep", declaredBy: ["words-kept"] },
        { id: "kept#2", quote: keptQuote, role: "keep", declaredBy: ["hello-kept"] },
      ],
    });
    const [reconciled] = await chainRule("planned-coverage-reconciled-v3");
    expect(reconciled).toMatchObject({
      requirements: expect.arrayContaining([
        { id: "kept", retained: ["words-kept"], rejected: ["hello-kept"], covered: true },
      ]),
      outcomes: expect.arrayContaining([
        expect.objectContaining({ id: "kept#1", covered: true, retained: ["words-kept"] }),
        expect.objectContaining({ id: "kept#2", covered: false, retained: [] }),
      ]),
    });
    // The bounded revision is told which outcome no admitted check states, not only which check fell.
    const revisionBrief =
      model.requests
        .flatMap((request) => request.messages)
        .flatMap((message) => (message.role === "user" ? [message.text] : []))
        .find((text) => text.includes("were each run once on a fresh checkout")) ?? "";
    expect(revisionBrief).toContain("Requested outcomes no admitted check states now");
    expect(revisionBrief).toContain(
      `- kept#2 (kept behaviour, quoting ${JSON.stringify(keptQuote)})`,
    );
    expect(notes.join("\n")).toContain("requested outcomes no retained check states: kept#2");
  });

  it("keeps an outcome unresolved when its revision is withheld for time", async () => {
    let now = 0;
    const { planner } = planning([siblings, respondWithText("pinned")], {
      clock: { now: () => now, sleep: () => Promise.resolve() },
      maxWallMs: 200_000,
      admit: (chain, contract, base, options) => {
        now += 100_000;
        return realAdmission(chain, contract, base, options);
      },
    });
    const outcome = await planChecks(planner);
    expect(outcome.admission?.revision.outcome).toBe("withheld");
    expect(outcome.admission?.uncovered).toEqual([]);
    expect(outcome.admission?.unresolvedOutcomes.map((one) => one.id)).toEqual(["kept#2"]);
    expect(outcome.admission?.unresolvedOutcomes[0]?.reason).toContain(
      "no revision ran: too little planning time remained",
    );
  });

  it("keeps an outcome unresolved when its check is declared again stating other words", async () => {
    // D1's scheme check was first declared quoting the task's example, then replaced by one quoting
    // only the general rule: the example's outcome had no check left, and nothing said so.
    const { planner } = planning([
      respondWithToolCalls("pinning", [
        declare(
          "dashes",
          "change",
          "spaces",
          "slugify turns spaces into dashes",
          [
            { input: "a b", expected: "a-b", changed: true },
            { input: "plain", expected: "plain", changed: false },
          ],
          "the task says spaces become dashes",
        ),
        declare(
          "kept-forms",
          "preserve",
          "kept",
          keptQuote,
          [{ input: "Hello World", expected: "hello-world" }],
          "the task says this still holds",
        ),
        declare(
          "kept-forms",
          "preserve",
          "kept",
          wordQuote,
          [
            { input: "plain", expected: "plain" },
            { input: "word", expected: "word" },
          ],
          "the task says a word comes back as it is",
        ),
        reviewOf("spaces", ["dashes"]),
        reviewOf("kept", ["kept-forms"]),
      ]),
      respondWithText("pinned"),
    ]);
    const outcome = await planChecks(planner);
    if (outcome.kind !== "sealed") throw new Error(`sealed, not ${outcome.kind}`);
    expect(outcome.admission?.uncovered).toEqual([]);
    expect(outcome.admission?.unresolvedOutcomes).toEqual([
      expect.objectContaining({
        id: "kept#1",
        quote: keptQuote,
        checks: [
          {
            check: "kept-forms",
            reason: `declared again quoting ${JSON.stringify(wordQuote)}, so it no longer states this outcome`,
          },
        ],
      }),
    ]);
  });
  // The requested example through a check's revisions. The base (slugify returns its input) gives
  // "Hello World" back unchanged where the task says it must read "hello-world".
  const keptFirst: FixtureTurn = respondWithToolCalls("pinning", [
    declare(
      "dashes",
      "change",
      "spaces",
      "slugify turns spaces into dashes",
      [
        { input: "a b", expected: "a-b", changed: true },
        { input: "plain", expected: "plain", changed: false },
      ],
      "the task says spaces become dashes",
    ),
    declare(
      "kept-forms",
      "preserve",
      "kept",
      keptQuote,
      [
        { input: "plain", expected: "plain" },
        { input: "Hello World", expected: "hello-world" },
      ],
      "the task says these still hold",
    ),
    reviewOf("spaces", ["dashes"]),
    reviewOf("kept", ["kept-forms"]),
  ]);
  const revising = (
    cases: readonly { input: string; expected: string; changed?: boolean }[],
    purpose: "change" | "preserve" = "preserve",
  ): FixtureTurn =>
    respondWithToolCalls("revising", [
      declare("kept-forms", purpose, "kept", keptQuote, cases, "corrected from what the base gave"),
    ]);
  const unresolvedOf = async (turns: readonly FixtureTurn[]) => {
    const { planner } = planning(turns);
    const outcome = await planChecks(planner);
    if (outcome.kind !== "sealed") throw new Error(`sealed, not ${outcome.kind}`);
    return outcome;
  };

  it("refuses a revision that takes the base's answer for the task's own input, and keeps the outcome unresolved", async () => {
    const outcome = await unresolvedOf([
      keptFirst,
      respondWithText("pinned"),
      revising([
        { input: "plain", expected: "plain" },
        { input: "Hello World", expected: "Hello World" },
      ]),
      respondWithText("revised"),
    ]);
    expect(outcome.admission?.revision.outcome).toBe("ran");
    const decisions = (await chainRule("planned-check-admission-v4")).flatMap(
      (one) =>
        one.decisions as { check: string; finding: string; admitted: boolean; reason: string }[],
    );
    expect(decisions.at(-1)).toMatchObject({
      check: "kept-forms",
      finding: "adopts-base-answer",
      admitted: false,
    });
    expect(decisions.at(-1)?.reason).toContain("The base's answer is an observation");
    expect(outcome.admission?.unresolvedOutcomes).toEqual([
      expect.objectContaining({
        requirement: "kept",
        quote: keptQuote,
        role: "keep",
        taskInputs: [{ input: "Hello World", expected: '"hello-world"', base: '"Hello World"' }],
        nextAction: expect.stringContaining('the task names "Hello World"'),
      }),
    ]);
    const [reconciled] = await chainRule("planned-coverage-reconciled-v3");
    expect(reconciled?.interpretation).toContainEqual({
      requirement: "kept",
      check: "kept-forms",
      input: "Hello World",
      version: "2.1",
      quote: keptQuote,
      from: '"hello-world"',
      to: '"Hello World"',
      base: '"Hello World"',
      toRecordedBase: true,
    });
  });

  it("records the launch's sequence on one check: the example expected, then the base's answer as a change, then dropped", async () => {
    const outcome = await unresolvedOf([
      respondWithToolCalls("pinning", [
        declare(
          "dashes",
          "change",
          "spaces",
          "slugify turns spaces into dashes",
          [
            { input: "a b", expected: "a-b", changed: true },
            { input: "plain", expected: "plain", changed: false },
          ],
          "the task says spaces become dashes",
        ),
        declare(
          "kept-forms",
          "preserve",
          "kept",
          keptQuote,
          [
            { input: "plain", expected: "plain" },
            { input: "Hello World", expected: "hello-world" },
          ],
          "the task says these still hold",
        ),
        {
          ...declare(
            "kept-forms",
            "change",
            "kept",
            keptQuote,
            [
              { input: "Hello World", expected: "Hello World", changed: true },
              { input: "plain", expected: "plain", changed: false },
            ],
            "it changes",
          ),
          callId: "declare-kept-forms-base",
        },
        {
          ...declare(
            "kept-forms",
            "preserve",
            "kept",
            '"Hello World" must still read',
            [
              { input: "plain", expected: "plain" },
              { input: "Hi there", expected: "Hi there" },
            ],
            "easier",
          ),
          callId: "declare-kept-forms-easier",
        },
        reviewOf("spaces", ["dashes"]),
        reviewOf("kept", ["kept-forms"]),
      ]),
      respondWithText("pinned"),
    ]);
    // The task's example has no check that holds it as asked, whatever the last version admits.
    expect(outcome.admission?.unresolvedOutcomes.some((one) => one.quote === keptQuote)).toBe(true);
    const [reconciled] = await chainRule("planned-coverage-reconciled-v3");
    const trail = (reconciled?.interpretation ?? []) as {
      version: string;
      from: string | null;
      to: string | null;
    }[];
    expect(trail.map((one) => [one.version, one.from, one.to])).toEqual([
      ["1.2", '"hello-world"', '"Hello World"'],
      ["1.3", '"Hello World"', null],
    ]);
  });

  it("keeps an outcome unresolved when a revision moves its check off the task's own input onto an easier one", async () => {
    const outcome = await unresolvedOf([
      keptFirst,
      respondWithText("pinned"),
      revising([
        { input: "plain", expected: "plain" },
        { input: "Hi there", expected: "Hi there" },
      ]),
      respondWithText("revised"),
    ]);
    // The replacement is a fine check of what it checks, and is admitted as one.
    expect(outcome.admission?.revision).toMatchObject({ outcome: "ran", admitted: ["kept-forms"] });
    expect(outcome.admission?.unresolvedOutcomes).toEqual([
      expect.objectContaining({
        quote: keptQuote,
        taskInputs: [{ input: "Hello World", expected: '"hello-world"', base: '"Hello World"' }],
        checks: [
          {
            check: "kept-forms",
            reason: expect.stringContaining(
              'its cases do not hold the task\'s own input "Hello World" (they are "plain", "Hi there" now)',
            ),
          },
        ],
      }),
    ]);
  });

  it("covers the outcome when a wrong expectation is corrected on the task's own input, and records the correction", async () => {
    const outcome = await unresolvedOf([
      respondWithToolCalls("pinning", [
        declare(
          "dashes",
          "change",
          "spaces",
          "slugify turns spaces into dashes",
          [
            { input: "a b", expected: "a-b", changed: true },
            { input: "plain", expected: "plain", changed: false },
          ],
          "the task says spaces become dashes",
        ),
        // A misspelt expectation for the task's own input.
        declare(
          "kept-forms",
          "preserve",
          "kept",
          keptQuote,
          [
            { input: "plain", expected: "plain" },
            { input: "Hello World", expected: "hello_world" },
          ],
          "the task says these still hold",
        ),
        reviewOf("spaces", ["dashes"]),
        reviewOf("kept", ["kept-forms"]),
      ]),
      respondWithText("pinned"),
      // Corrected to the task's words and declared as the change the base does not give yet.
      revising(
        [
          { input: "Hello World", expected: "hello-world", changed: true },
          { input: "plain", expected: "plain", changed: false },
        ],
        "change",
      ),
      respondWithText("revised"),
    ]);
    expect(outcome.admission?.revision).toMatchObject({ outcome: "ran", admitted: ["kept-forms"] });
    expect(outcome.admission?.unresolvedOutcomes).toEqual([]);
    const [reconciled] = await chainRule("planned-coverage-reconciled-v3");
    expect(reconciled?.interpretation).toContainEqual({
      requirement: "kept",
      check: "kept-forms",
      input: "Hello World",
      version: "2.1",
      quote: keptQuote,
      from: '"hello_world"',
      to: '"hello-world"',
      base: '"Hello World"',
      toRecordedBase: false,
    });
  });

  it("reads the same check declared again with its words kept and its inputs held as one outcome, not two", async () => {
    const changed = [
      { input: "Hello World", expected: "hello-world", changed: true },
      { input: "plain", expected: "plain", changed: false },
    ];
    const wordQuote = "A word without spaces must still come back as it is";
    const words = [
      { input: "plain", expected: "plain" },
      { input: "word", expected: "word" },
    ];
    const outcome = await unresolvedOf([
      respondWithToolCalls("pinning", [
        declare(
          "dashes",
          "change",
          "spaces",
          "slugify turns spaces into dashes",
          [
            { input: "a b", expected: "a-b", changed: true },
            { input: "plain", expected: "plain", changed: false },
          ],
          "the task says spaces become dashes",
        ),
        // The quote, then the quote with the sentence around it.
        declare("kept-forms", "change", "kept", keptQuote, changed, "the task names it"),
        {
          ...declare(
            "kept-forms",
            "change",
            "kept",
            `and ${keptQuote}.`,
            changed,
            "the task names it",
          ),
          callId: "declare-kept-forms-again",
        },
        // A preserve check first declared quoting nothing, then with the task's words.
        {
          callId: "declare-words-unquoted",
          toolName: "declare_planned_check",
          input: {
            id: "words",
            purpose: "preserve",
            requirementId: "unchanged",
            requirement: "a word comes back as it is",
            program,
            cases: words,
            why: "the task keeps it",
          },
        },
        {
          ...declare("words", "preserve", "unchanged", wordQuote, words, "the task keeps it"),
          callId: "declare-words-quoted",
        },
        reviewOf("spaces", ["dashes"]),
        reviewOf("kept", ["kept-forms"]),
        reviewOf("unchanged", ["words"]),
      ]),
      respondWithText("pinned"),
    ]);
    expect(outcome.admission?.unresolvedOutcomes).toEqual([]);
    const [reconciled] = await chainRule("planned-coverage-reconciled-v3");
    const restated = (
      (reconciled?.outcomes ?? []) as { requirement: string; restatedAs: unknown[]; role: string }[]
    )
      .filter((one) => one.requirement !== "spaces")
      .map((one) => [one.requirement, one.role, one.restatedAs.length]);
    // One outcome per behaviour, each restated once, rather than two of each.
    expect(restated).toEqual([
      ["kept", "change", 1],
      ["kept", "keep", 1],
      ["unchanged", "keep", 1],
    ]);
  });

  it("keeps an earlier statement when the check is declared again with words dropped", async () => {
    const changed = [
      { input: "Hello World", expected: "hello-world", changed: true },
      { input: "plain", expected: "plain", changed: false },
    ];
    const outcome = await unresolvedOf([
      respondWithToolCalls("pinning", [
        declare(
          "dashes",
          "change",
          "spaces",
          "slugify turns spaces into dashes",
          [
            { input: "a b", expected: "a-b", changed: true },
            { input: "plain", expected: "plain", changed: false },
          ],
          "the task says spaces become dashes",
        ),
        declare("kept-forms", "change", "kept", keptQuote, changed, "the task names it"),
        {
          ...declare(
            "kept-forms",
            "change",
            "kept",
            '"Hello World" must still read',
            changed,
            "the task names it",
          ),
          callId: "declare-kept-forms-shorter",
        },
        reviewOf("spaces", ["dashes"]),
        reviewOf("kept", ["kept-forms"]),
      ]),
      respondWithText("pinned"),
    ]);
    expect(outcome.admission?.unresolvedOutcomes.map((one) => [one.quote, one.role])).toEqual([
      [keptQuote, "change"],
      [keptQuote, "keep"],
    ]);
  });

  it("keeps two behaviours one quote states on two task inputs apart, when only one input is checked", async () => {
    const twoInputs =
      'slugify turns spaces into dashes: "Hello World" must read "hello-world" and "New York" must read "new-york".';
    const sentence = twoInputs.slice(0, -1);
    const { planner } = planning(
      [
        respondWithToolCalls("pinning", [
          declare(
            "hello",
            "change",
            "examples",
            sentence,
            [
              { input: "Hello World", expected: "hello-world", changed: true },
              { input: "plain", expected: "plain", changed: false },
            ],
            "the task names it",
          ),
          // Its kept case is wrong, so admission refuses it.
          declare(
            "new-york",
            "change",
            "examples",
            sentence,
            [
              { input: "New York", expected: "new-york", changed: true },
              { input: "word", expected: "WORD", changed: false },
            ],
            "the task names it",
          ),
          reviewOf("examples", ["hello", "new-york"]),
        ]),
        respondWithText("pinned"),
        respondWithText("No replacement."),
      ],
      {
        task: twoInputs,
        admit: (chain, contract, base, options) =>
          admitPlannedChecks({
            task: twoInputs,
            contract,
            base,
            evidence: chain,
            verifyAtBase: (probe) => simulatedBase(chain, probe),
            ...(options?.contested === undefined ? {} : { contested: options.contested }),
          }),
      },
    );
    const outcome = await planChecks(planner);
    if (outcome.kind !== "sealed") throw new Error(`sealed, not ${outcome.kind}`);
    const unresolved = outcome.admission?.unresolvedOutcomes ?? [];
    expect(unresolved.map((one) => [one.requirement, one.role])).toEqual([["examples", "change"]]);
    expect(unresolved[0]?.taskInputs.map((one) => one.input)).toEqual(["Hello World", "New York"]);
    expect(unresolved[0]?.checks.find((one) => one.check === "hello")?.reason).toContain(
      'its cases do not hold the task\'s own input "New York"',
    );
  });
});
